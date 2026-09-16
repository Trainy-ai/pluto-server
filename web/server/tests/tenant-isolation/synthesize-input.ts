/**
 * JSON Schema → sample input, for the tenant-isolation suite.
 *
 * `docs/api-surface.json` records every tRPC procedure's input as the JSON
 * Schema zod-to-json-schema derives from its Zod parser. The suite needs one
 * request per procedure that passes that parser and carries the *other*
 * tenant's identifiers, without anyone hand-writing 90+ inputs — and without
 * a hand-written input silently going stale when a procedure's schema
 * changes. This module walks the schema and fills in the required fields;
 * any property whose key is present in `values` takes that value verbatim,
 * which is how the caller injects org 2's run id, view id, project name and
 * so on at every depth (a nested `metrics[].logName` is substituted the same
 * way as a top-level `runId`).
 *
 * It is deliberately conservative: only required properties are produced
 * (plus every property named in `values`), enums take their first member,
 * numbers sit on their lower bound, arrays get the smallest non-empty length
 * the schema allows. A procedure whose parser still rejects the result needs
 * an entry in `overrides.ts`; the suite turns a 400 into a failure rather
 * than a pass so that cannot go unnoticed.
 */

export interface JsonSchema {
  type?: string | string[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: unknown[];
  const?: unknown;
  anyOf?: JsonSchema[];
  oneOf?: JsonSchema[];
  allOf?: JsonSchema[];
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
  minItems?: number;
  maxItems?: number;
  minLength?: number;
  format?: string;
  additionalProperties?: boolean | JsonSchema;
  [key: string]: unknown;
}

/**
 * Input keys that name a specific tenant-owned row. A procedure that requires
 * one of these must reject a foreign id outright (404/403): there is no
 * legitimate "empty" answer to "show me run X" when X is not yours.
 */
export const RESOURCE_ID_KEYS = [
  'runId',
  'runIds',
  'viewId',
  'sweepId',
  'memberId',
  'invitationId',
  'apiKeyId',
  'notificationIds',
  'newOwnerId',
] as const;

/**
 * Keys that scope a request to a tenant-owned container rather than a row.
 * A foreign project name legitimately resolves to "no such project here", so
 * an empty 200 is acceptable — as long as the body carries nothing of the
 * other tenant's.
 */
export const CONTAINER_KEYS = ['projectName'] as const;

export const IDENTIFIER_KEYS: readonly string[] = [...RESOURCE_ID_KEYS, ...CONTAINER_KEYS];

const MAX_DEPTH = 10;
const FILLER_STRING = 'tenant-isolation';

/** Collapse `allOf` into one object schema (tRPC merges chained `.input()` calls this way). */
export function flattenSchema(schema: JsonSchema | null | undefined): JsonSchema {
  if (!schema) {
    return { type: 'object', properties: {}, required: [] };
  }
  if (!schema.allOf) {
    return schema;
  }
  const merged: JsonSchema = { type: 'object', properties: {}, required: [] };
  for (const part of schema.allOf) {
    const flat = flattenSchema(part);
    Object.assign(merged.properties!, flat.properties ?? {});
    for (const key of flat.required ?? []) {
      if (!merged.required!.includes(key)) {
        merged.required!.push(key);
      }
    }
  }
  return merged;
}

export function synthesizeInput(
  schema: JsonSchema | null | undefined,
  values: Record<string, unknown>,
): Record<string, unknown> {
  const flat = flattenSchema(schema);
  const result = synthesize(flat, undefined, values, 0);
  return result && typeof result === 'object' && !Array.isArray(result)
    ? (result as Record<string, unknown>)
    : {};
}

function synthesize(
  schema: JsonSchema,
  key: string | undefined,
  values: Record<string, unknown>,
  depth: number,
): unknown {
  if (key !== undefined && Object.prototype.hasOwnProperty.call(values, key)) {
    return values[key];
  }
  if (depth > MAX_DEPTH) {
    return undefined;
  }
  if (schema.const !== undefined) {
    return schema.const;
  }
  if (schema.enum && schema.enum.length > 0) {
    return schema.enum[0];
  }
  if (schema.allOf) {
    return synthesize(flattenSchema(schema), key, values, depth + 1);
  }
  const branches = schema.anyOf ?? schema.oneOf;
  if (branches && branches.length > 0) {
    const branch = branches.find((candidate) => candidate.type !== 'null') ?? branches[0];
    return synthesize(branch, key, values, depth + 1);
  }

  const type = Array.isArray(schema.type)
    ? (schema.type.find((candidate) => candidate !== 'null') ?? schema.type[0])
    : schema.type;

  switch (type) {
    case 'object':
      return synthesizeObject(schema, values, depth);
    case 'array': {
      const items = schema.items ?? { type: 'string' };
      let length = Math.max(schema.minItems ?? 1, 1);
      if (schema.maxItems !== undefined) {
        length = Math.min(length, schema.maxItems);
      }
      return Array.from({ length }, () => synthesize(items, undefined, values, depth + 1));
    }
    case 'string':
      return synthesizeString(schema);
    case 'number':
    case 'integer':
      return synthesizeNumber(schema, type === 'integer');
    case 'boolean':
      return false;
    case 'null':
      return null;
    default:
      // Untyped: zod-to-json-schema emits `{}` for z.any()/z.unknown() and for
      // recursive references it gave up on. An object literal is the safest
      // value for both.
      return schema.properties ? synthesizeObject(schema, values, depth) : {};
  }
}

function synthesizeObject(
  schema: JsonSchema,
  values: Record<string, unknown>,
  depth: number,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const required = new Set(schema.required ?? []);
  for (const [key, property] of Object.entries(schema.properties ?? {})) {
    if (Object.prototype.hasOwnProperty.call(values, key)) {
      result[key] = values[key];
    } else if (required.has(key)) {
      result[key] = synthesize(property, key, values, depth + 1);
    }
  }
  return result;
}

function synthesizeString(schema: JsonSchema): string {
  if (schema.format === 'email') {
    return 'tenant-isolation@example.com';
  }
  if (schema.format === 'date-time') {
    return '2024-01-01T00:00:00.000Z';
  }
  if (schema.format === 'uuid') {
    return '00000000-0000-4000-8000-000000000000';
  }
  const minLength = schema.minLength ?? 0;
  return minLength > FILLER_STRING.length
    ? FILLER_STRING.padEnd(minLength, 'x')
    : FILLER_STRING;
}

function synthesizeNumber(schema: JsonSchema, integer: boolean): number {
  let value: number;
  if (schema.minimum !== undefined) {
    value = schema.minimum;
  } else if (schema.exclusiveMinimum !== undefined) {
    value = integer ? schema.exclusiveMinimum + 1 : schema.exclusiveMinimum + 0.5;
  } else {
    value = 1;
  }
  if (schema.maximum !== undefined && value > schema.maximum) {
    value = schema.maximum;
  }
  return integer ? Math.ceil(value) : value;
}

export interface IdentifierUsage {
  /** identifier keys the (flattened) input declares, required or not */
  present: string[];
  /** identifier keys the input requires */
  required: string[];
}

export function identifierKeysIn(schema: JsonSchema | null | undefined): IdentifierUsage {
  const flat = flattenSchema(schema);
  const declared = Object.keys(flat.properties ?? {});
  const required = new Set(flat.required ?? []);
  const present = declared.filter((key) => IDENTIFIER_KEYS.includes(key));
  return {
    present,
    required: present.filter((key) => required.has(key)),
  };
}

export type ScopingExpectation = 'reject' | 'no-leak' | 'skip';

/**
 * What the resource-scoping check demands of a procedure by default.
 *
 * - `reject`: a required row identifier (run, view, sweep, member, …) — the
 *   only correct answers to a foreign id are 404/403.
 * - `no-leak`: identifiers are optional or name a container (project). An
 *   empty 200 is fine; a 200 carrying the other tenant's data is not.
 * - `skip`: the input names nothing tenant-owned beyond `organizationId`
 *   itself, which the membership check already covers.
 */
export function defaultScopingExpectation(schema: JsonSchema | null | undefined): ScopingExpectation {
  const usage = identifierKeysIn(schema);
  if (usage.required.some((key) => (RESOURCE_ID_KEYS as readonly string[]).includes(key))) {
    return 'reject';
  }
  return usage.present.length > 0 ? 'no-leak' : 'skip';
}
