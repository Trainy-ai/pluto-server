/** Encoding/decoding of "group field" identifiers used by the W&B-style
 *  run-grouping API. A group field tells the server WHICH column (or
 *  pseudo-column) to bucket runs on, e.g. `system:status` to group by
 *  run status, or `config:lr` to group by a user-defined config key.
 *
 *  Encoded form: `<kind>:<key>` where `<kind>` is one of the four below.
 *  The colon separator is deliberate — config/systemMetadata keys can
 *  contain dots, slashes, and other punctuation, but we control the
 *  `kind` prefix so a single colon split is unambiguous. */

export const GROUP_FIELD_KINDS = ["system", "config", "systemMetadata", "tag-prefix"] as const;
export type GroupFieldKind = (typeof GROUP_FIELD_KINDS)[number];

/** System columns the picker exposes. Restricted by what we can sensibly
 *  bucket on; e.g. `notes` is unique per run so grouping by it is useless. */
export const SUPPORTED_SYSTEM_GROUP_FIELDS = ["status", "name", "creator.name"] as const;

/** Tag-prefix conventions the picker exposes. `group` is the W&B-style
 *  `group:<value>` tag — the only prefix at launch, but the design is
 *  open to adding `sweep:`, `job-type:`, etc. without backend changes. */
export const SUPPORTED_TAG_PREFIXES = ["group"] as const;

export interface ParsedGroupField {
  kind: GroupFieldKind;
  key: string;
}

/** Parse `<kind>:<key>` into its parts. Returns null for unknown kinds or
 *  malformed input — callers should treat null as "skip this group". */
export function parseGroupField(field: string): ParsedGroupField | null {
  const idx = field.indexOf(":");
  if (idx <= 0 || idx === field.length - 1) return null;
  const kind = field.slice(0, idx);
  const key = field.slice(idx + 1);
  if (!GROUP_FIELD_KINDS.includes(kind as GroupFieldKind)) return null;
  return { kind: kind as GroupFieldKind, key };
}

export function encodeGroupField(kind: GroupFieldKind, key: string): string {
  return `${kind}:${key}`;
}

/** A single (field, value) pair identifying a bucket the client wants to
 *  drill into. `value` of null means "runs without a value for this
 *  field" (e.g. ungrouped runs, runs without a config.lr). */
export interface GroupFilter {
  field: string;
  value: string | null;
}

/** Subset of list-runs / runs-count input we need to mutate when
 *  translating group filters into existing filter arrays. */
export interface FilterableInputShape {
  tags?: string[];
  status?: string[];
  fieldFilters?: Array<{
    source: "config" | "systemMetadata";
    key: string;
    dataType: "text" | "number" | "date" | "option";
    operator: string;
    values: unknown[];
  }>;
  systemFilters?: Array<{
    field: "name" | "status" | "tags" | "creator.name" | "notes";
    operator: string;
    values: unknown[];
  }>;
  /** Tag prefixes the run must NOT carry. Synthetic — populated only
   *  by the group-filter translator when the user drills into a
   *  tag-prefix "(unset)" bucket. Consumed by the raw-SQL paths in
   *  list-runs.ts / runs-count.ts. */
  tagPrefixExclusions?: string[];
}

/** Translate `groupFilters` into entries on the existing filter arrays so
 *  the standard listing pipeline can apply them without bespoke SQL.
 *
 *  `keyDataTypes` maps "config:<key>" / "systemMetadata:<key>" strings to
 *  their cached ProjectColumnKey dataType — required so a config:lr
 *  filter against a numeric column uses `numericValue` and not
 *  `textValue`. Unknown keys default to "text". */
export function applyGroupFiltersToInput<T extends FilterableInputShape>(
  input: T,
  groupFilters: readonly GroupFilter[],
  keyDataTypes: Map<string, "text" | "number" | "date">,
): T {
  if (groupFilters.length === 0) return input;

  // We mutate copies to keep the caller's input untouched.
  const out: T = {
    ...input,
    tags: input.tags ? [...input.tags] : [],
    status: input.status ? [...input.status] : undefined,
    fieldFilters: input.fieldFilters ? [...input.fieldFilters] : [],
    systemFilters: input.systemFilters ? [...input.systemFilters] : [],
    tagPrefixExclusions: input.tagPrefixExclusions ? [...input.tagPrefixExclusions] : [],
  };

  for (const gf of groupFilters) {
    const parsed = parseGroupField(gf.field);
    if (!parsed) continue;

    if (parsed.kind === "system") {
      // System fields are always non-null in the schema; null group
      // values are nonsense here so we drop them rather than emit a
      // filter that would silently match everything.
      if (gf.value == null) continue;
      if (parsed.key === "status") {
        // Push to the dedicated status array — same shape `runs.list`
        // already supports, plays nicely with the cheap Prisma path
        // when no other advanced filters are present.
        out.status = out.status ?? [];
        out.status.push(gf.value);
      } else if (parsed.key === "name" || parsed.key === "creator.name") {
        out.systemFilters!.push({
          field: parsed.key,
          operator: "is",
          values: [gf.value],
        });
      }
    } else if (parsed.kind === "config" || parsed.kind === "systemMetadata") {
      const dt = keyDataTypes.get(`${parsed.kind}:${parsed.key}`) ?? "text";
      if (gf.value == null) {
        // Drill into the "unset" bucket — runs without this key in
        // run_field_values.
        out.fieldFilters!.push({
          source: parsed.kind,
          key: parsed.key,
          dataType: dt === "date" ? "date" : dt,
          operator: "not exists",
          values: [],
        });
      } else if (dt === "number") {
        const n = Number(gf.value);
        if (!Number.isFinite(n)) continue;
        // "is" — the only "equals" operator the number switch in
        // buildValueCondition (list-runs.ts) recognises.
        out.fieldFilters!.push({
          source: parsed.kind,
          key: parsed.key,
          dataType: "number",
          operator: "is",
          values: [n],
        });
      } else {
        out.fieldFilters!.push({
          source: parsed.kind,
          key: parsed.key,
          dataType: "text",
          operator: "is",
          values: [gf.value],
        });
      }
    } else if (parsed.kind === "tag-prefix") {
      if (gf.value == null) {
        // Drill into the "no group:* tag" bucket — translated by the
        // raw-SQL paths into `NOT EXISTS (… tag LIKE 'group:%')`.
        out.tagPrefixExclusions!.push(`${parsed.key}:`);
      } else {
        out.tags!.push(`${parsed.key}:${gf.value}`);
      }
    }
  }

  // Normalize empties so consumers can rely on `?.length` checks.
  if (out.tags && out.tags.length === 0) out.tags = undefined;
  if (out.status && out.status.length === 0) out.status = undefined;
  if (out.fieldFilters && out.fieldFilters.length === 0) out.fieldFilters = undefined;
  if (out.systemFilters && out.systemFilters.length === 0) out.systemFilters = undefined;
  if (out.tagPrefixExclusions && out.tagPrefixExclusions.length === 0) out.tagPrefixExclusions = undefined;
  return out;
}

/** Build SQL conditions for "no run tag starts with this prefix".
 *  Appends to the shared `conditions` / `queryParams` arrays used by
 *  the raw-SQL paths in list-runs.ts and runs-count.ts. */
export function buildTagPrefixExclusionConditions(
  conditions: string[],
  queryParams: (string | bigint | string[] | number)[],
  tagPrefixExclusions?: readonly string[],
): void {
  if (!tagPrefixExclusions?.length) return;
  for (const prefix of tagPrefixExclusions) {
    queryParams.push(prefix);
    const idx = queryParams.length;
    conditions.push(
      `NOT EXISTS (SELECT 1 FROM UNNEST(r.tags) AS t WHERE t LIKE $${idx} || '%')`,
    );
  }
}

/** Fetch dataType metadata for any (source, key) pair referenced by a
 *  list of group filters. Returns "text" as a safe fallback when a key
 *  is missing from ProjectColumnKey.
 *
 *  `prisma` is typed as `any` rather than `PrismaClient` to keep this
 *  module free of a Prisma import (callers pass `ctx.prisma`). */
export async function loadGroupFilterDataTypes(
  prisma: any,
  projectId: bigint,
  groupFilters: readonly GroupFilter[],
): Promise<Map<string, "text" | "number" | "date">> {
  const keys: { source: "config" | "systemMetadata"; key: string }[] = [];
  for (const gf of groupFilters) {
    const parsed = parseGroupField(gf.field);
    if (parsed && (parsed.kind === "config" || parsed.kind === "systemMetadata")) {
      keys.push({ source: parsed.kind, key: parsed.key });
    }
  }
  const out = new Map<string, "text" | "number" | "date">();
  if (keys.length === 0) return out;
  const rows = await prisma.projectColumnKey.findMany({
    where: {
      projectId,
      OR: keys.map((k) => ({ source: k.source, key: k.key })),
    },
    select: { source: true, key: true, dataType: true },
  });
  for (const r of rows) {
    const dt = r.dataType === "number" || r.dataType === "date" ? r.dataType : "text";
    out.set(`${r.source}:${r.key}`, dt);
  }
  return out;
}
