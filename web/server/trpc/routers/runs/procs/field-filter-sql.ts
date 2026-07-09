// Field-filter SQL builders: compile FieldFilter conditions (config/systemMetadata
// key filters from the runs-table UI and the wandb-style `filters` query language)
// into parameterized WHERE-clause fragments against run_field_values. Extracted
// from list-runs.ts; shared by list-runs, runs-count, distinct-group-values and
// the OpenAPI /api/runs/list field-filter path (queryFieldFilteredRunIds).
import { z } from "zod";


// The complete operator vocabulary the field-filter builder (buildValueCondition
// below) accepts, across all dataTypes — symbolic + phrase synonyms, exists/not
// exists, and negated forms. Used to document the `FieldFilterTerm` OpenAPI
// component (web/server/index.ts) and by the run-filter compiler. NOTE: kept as
// the operator vocabulary, but `fieldFilterSchema.operator` stays `z.string()`
// at runtime — the schema is shared with the tRPC table-UI input and the web/app
// frontend (which type operators as plain strings), so a strict enum here would
// break their type-checks. The OpenAPI enum is published doc-only.
export const FIELD_FILTER_OPERATORS = [
  "contains",
  "does not contain",
  "equals",
  "is",
  "is not",
  "starts with",
  "ends with",
  "regex",
  "is greater than",
  ">",
  "is less than",
  "<",
  "is greater than or equal to",
  ">=",
  "is less than or equal to",
  "<=",
  "is between",
  "is not between",
  "is before",
  "is on or before",
  "is after",
  "is on or after",
  "is any of",
  "is none of",
  "exists",
  "not exists",
] as const;

export type FieldFilterOperator = (typeof FIELD_FILTER_OPERATORS)[number];

export const fieldFilterSchema = z.object({
  source: z.enum(["config", "systemMetadata"]),
  key: z.string(),
  dataType: z.enum(["text", "number", "date", "option"]),
  operator: z.string(),
  values: z.array(z.any()),
});

export type FieldFilter = z.infer<typeof fieldFilterSchema>;

// The SQL builders below dispatch on the operator string and ignore unknowns, so
// they accept a structurally-typed term with `operator` widened to string. This
// lets callers that keep their own looser filter schema (e.g. runs-count) reuse
// the builders without coupling to the operator enum.
type FieldFilterCondition = Omit<FieldFilter, "operator"> & { operator: string };


/** Map negated operators to their positive equivalents.
 *  Negated field filters exclude the runs matching the positive condition
 *  (via NOT IN) so that runs without the field at all are correctly included. */
const NEGATED_TO_POSITIVE: Record<string, FieldFilterOperator> = {
  "does not contain": "contains",
  "is not": "is",
  "is not between": "is between",
  "is none of": "is any of",
};


/**
 * The tenant/project scope a negated filter's uncorrelated subquery is bound
 * to. Prefer `projectId` (direct prefix of the rfv_proj_src_key_num index);
 * `projectName` resolves the id via a scalar subquery on "projects" (an
 * InitPlan — evaluated once); bare `organizationId` is the fallback and costs
 * one seq scan of the org's field-value rows per filter.
 */
export interface FieldFilterScope {
  organizationId: string;
  projectId?: bigint;
  projectName?: string;
}

/**
 * Append WHERE-clause conditions for field filters against run_field_values.
 *
 * Positive operators become EXISTS subqueries correlated on r.id +
 * r."projectId" (planned as an index-friendly semi-join).
 *
 * Negated operators ("is none of" / `$nin`, "is not", "does not contain",
 * "is not between") and "not exists" become `r.id NOT IN (<uncorrelated
 * subquery matching the POSITIVE condition>)`. Runs without the field are
 * absent from the match set, so they are correctly included in the result.
 *
 * Why NOT IN rather than a correlated NOT EXISTS: NOT EXISTS plans as an
 * anti-join, and under a row-count misestimate Postgres picks a nested-loop
 * plan with a materialized inner that it rescans once per outer run — observed
 * in prod (2026-07-09) at ~500s per query on a 168K-run project, pinning every
 * Prisma pool connection (P2024 storm). An uncorrelated NOT IN is evaluated as
 * ONE inner scan + a hashed SubPlan probed per row — immune to join-planning
 * estimates (measured: ~77ms at 170K runs even with every join/scan method
 * disabled, vs statement timeout for the anti-join shape).
 * `run_field_values."runId"` is NOT NULL, so NOT IN's null-semantics footgun
 * (any NULL in the subquery result → empty result set) cannot trigger.
 */
export function buildFieldFilterConditions(
  conditions: string[],
  queryParams: (string | bigint | string[] | number)[],
  fieldFilters: FieldFilterCondition[] | undefined,
  scope: FieldFilterScope,
) {
  if (!fieldFilters?.length) return;

  for (let i = 0; i < fieldFilters.length; i++) {
    const ff = fieldFilters[i];
    const alias = `fv${i}`;

    // Positional param for source
    queryParams.push(ff.source);
    const srcIdx = queryParams.length;

    // Positional param for key
    queryParams.push(ff.key);
    const keyIdx = queryParams.length;

    // Shared source/key filter on the subquery.
    const srcKey = `${alias}."source" = $${srcIdx} AND ${alias}."key" = $${keyIdx}`;

    // Positive EXISTS: correlate on projectId too — not just runId. A run's
    // field-value rows always carry the run's projectId, so this never changes
    // results, but it lets Postgres use the `(projectId, source, key, …)` index
    // (rfv_proj_src_key_num) in the semi-join instead of scanning every
    // run_field_values row in the org.
    const baseJoin = `${alias}."runId" = r.id AND ${alias}."projectId" = r."projectId" AND ${srcKey}`;

    // Negated NOT IN: bind the scope as constants so the subquery stays
    // UNCORRELATED (see the function doc). Must not reference `r`.
    const notInScope = () => {
      if (scope.projectId != null) {
        queryParams.push(scope.projectId);
        return `${alias}."projectId" = $${queryParams.length}`;
      }
      if (scope.projectName != null) {
        queryParams.push(scope.organizationId);
        const orgIdx = queryParams.length;
        queryParams.push(scope.projectName);
        const nameIdx = queryParams.length;
        return `${alias}."projectId" = (SELECT sp.id FROM "projects" sp WHERE sp."organizationId" = $${orgIdx} AND sp.name = $${nameIdx})`;
      }
      queryParams.push(scope.organizationId);
      return `${alias}."organizationId" = $${queryParams.length}`;
    };

    // "exists" / "not exists" operators — no value comparison needed
    if (ff.operator === "exists") {
      conditions.push(`EXISTS (SELECT 1 FROM "run_field_values" ${alias} WHERE ${baseJoin})`);
      continue;
    }
    if (ff.operator === "not exists") {
      conditions.push(
        `r.id NOT IN (SELECT ${alias}."runId" FROM "run_field_values" ${alias} WHERE ${notInScope()} AND ${srcKey})`,
      );
      continue;
    }

    // Negated operator — exclude the runs matching the positive condition, so
    // that runs without the field are included.
    const positiveOp = NEGATED_TO_POSITIVE[ff.operator];
    if (positiveOp) {
      const positiveFilter = { ...ff, operator: positiveOp };
      // Build the scope SQL before the value condition so the positional
      // placeholders land in the order they appear in the emitted SQL.
      const scopeCond = notInScope();
      const valueCond = buildValueCondition(alias, positiveFilter, queryParams);
      if (valueCond) {
        conditions.push(
          `r.id NOT IN (SELECT ${alias}."runId" FROM "run_field_values" ${alias} WHERE ${scopeCond} AND ${srcKey} AND ${valueCond})`,
        );
      }
      continue;
    }

    // Positive operator — use EXISTS normally
    const valueCond = buildValueCondition(alias, ff, queryParams);
    if (valueCond) {
      conditions.push(`EXISTS (SELECT 1 FROM "run_field_values" ${alias} WHERE ${baseJoin} AND ${valueCond})`);
    }
  }
}


/**
 * Build the value comparison part of a field filter EXISTS subquery.
 * Returns the SQL condition string, or null if the operator is unknown.
 */
export function buildValueCondition(
  alias: string,
  ff: FieldFilterCondition,
  queryParams: (string | bigint | string[] | number)[],
): string | null {
  const { dataType, operator, values } = ff;

  if (dataType === "text") {
    const v = values[0] != null ? String(values[0]) : "";
    switch (operator) {
      case "contains": {
        queryParams.push(v);
        return `${alias}."textValue" ILIKE '%' || $${queryParams.length} || '%'`;
      }
      case "does not contain": {
        queryParams.push(v);
        return `(${alias}."textValue" IS NULL OR ${alias}."textValue" NOT ILIKE '%' || $${queryParams.length} || '%')`;
      }
      case "equals":
      case "is": {
        queryParams.push(v);
        return `${alias}."textValue" = $${queryParams.length}`;
      }
      case "is not": {
        queryParams.push(v);
        return `(${alias}."textValue" IS NULL OR ${alias}."textValue" != $${queryParams.length})`;
      }
      case "starts with": {
        queryParams.push(v);
        return `${alias}."textValue" ILIKE $${queryParams.length} || '%'`;
      }
      case "ends with": {
        queryParams.push(v);
        return `${alias}."textValue" ILIKE '%' || $${queryParams.length}`;
      }
      case "regex": {
        queryParams.push(v);
        return `${alias}."textValue" ~ $${queryParams.length}`;
      }
      default:
        return null;
    }
  }

  if (dataType === "number") {
    // Bind numeric values as STRINGS cast with `$N::double precision`, never as
    // raw JS numbers. `numericValue` is a Float8 column, but the placeholder SQL
    // text (`"numericValue" = $N`) is identical for every value, so Prisma's
    // prepared-statement cache locks the param's binary type to whatever value
    // first prepared it on a pooled connection. A JS integer prepares it as int
    // binary; the next float value on that cached statement is then sent as
    // float8 binary and Postgres rejects the mismatch with
    // `22P03 incorrect binary data format in bind parameter N`. Passing a string
    // + explicit cast makes the wire format deterministic (always text), so the
    // cached plan is valid for both integer- and float-valued filters.
    const cast = (idx: number) => `$${idx}::double precision`;
    switch (operator) {
      case "is": {
        const n = Number(values[0]);
        if (isNaN(n)) return null;
        queryParams.push(String(n));
        return `${alias}."numericValue" = ${cast(queryParams.length)}`;
      }
      case "is not": {
        const n = Number(values[0]);
        if (isNaN(n)) return null;
        queryParams.push(String(n));
        return `(${alias}."numericValue" IS NULL OR ${alias}."numericValue" != ${cast(queryParams.length)})`;
      }
      case "is greater than":
      case ">": {
        const n = Number(values[0]);
        if (isNaN(n)) return null;
        queryParams.push(String(n));
        return `${alias}."numericValue" > ${cast(queryParams.length)}`;
      }
      case "is less than":
      case "<": {
        const n = Number(values[0]);
        if (isNaN(n)) return null;
        queryParams.push(String(n));
        return `${alias}."numericValue" < ${cast(queryParams.length)}`;
      }
      case "is greater than or equal to":
      case ">=": {
        const n = Number(values[0]);
        if (isNaN(n)) return null;
        queryParams.push(String(n));
        return `${alias}."numericValue" >= ${cast(queryParams.length)}`;
      }
      case "is less than or equal to":
      case "<=": {
        const n = Number(values[0]);
        if (isNaN(n)) return null;
        queryParams.push(String(n));
        return `${alias}."numericValue" <= ${cast(queryParams.length)}`;
      }
      case "is between": {
        const n1 = Number(values[0]);
        const n2 = Number(values[1]);
        if (isNaN(n1) || isNaN(n2)) return null;
        queryParams.push(String(n1));
        const lo = queryParams.length;
        queryParams.push(String(n2));
        const hi = queryParams.length;
        return `${alias}."numericValue" BETWEEN ${cast(lo)} AND ${cast(hi)}`;
      }
      case "is not between": {
        const n1 = Number(values[0]);
        const n2 = Number(values[1]);
        if (isNaN(n1) || isNaN(n2)) return null;
        queryParams.push(String(n1));
        const lo = queryParams.length;
        queryParams.push(String(n2));
        const hi = queryParams.length;
        return `(${alias}."numericValue" IS NULL OR ${alias}."numericValue" NOT BETWEEN ${cast(lo)} AND ${cast(hi)})`;
      }
      default:
        return null;
    }
  }

  if (dataType === "date") {
    switch (operator) {
      case "is before":
      case "is on or before": {
        const v = String(values[0]);
        queryParams.push(v);
        return `${alias}."textValue" < $${queryParams.length}`;
      }
      case "is after":
      case "is on or after": {
        const v = String(values[0]);
        queryParams.push(v);
        return `${alias}."textValue" > $${queryParams.length}`;
      }
      case "is between": {
        const v1 = String(values[0]);
        const v2 = String(values[1]);
        queryParams.push(v1);
        const lo = queryParams.length;
        queryParams.push(v2);
        const hi = queryParams.length;
        return `${alias}."textValue" BETWEEN $${lo} AND $${hi}`;
      }
      default:
        return null;
    }
  }

  if (dataType === "option") {
    switch (operator) {
      case "is any of": {
        const arr = (Array.isArray(values[0]) ? values[0] : values).map(String);
        queryParams.push(arr as any);
        return `${alias}."textValue" = ANY($${queryParams.length}::text[])`;
      }
      case "is none of": {
        const arr = (Array.isArray(values[0]) ? values[0] : values).map(String);
        queryParams.push(arr as any);
        return `(${alias}."textValue" IS NULL OR ${alias}."textValue" != ALL($${queryParams.length}::text[]))`;
      }
      case "is": {
        const v = String(values[0]);
        queryParams.push(v);
        return `${alias}."textValue" = $${queryParams.length}`;
      }
      case "is not": {
        const v = String(values[0]);
        queryParams.push(v);
        return `(${alias}."textValue" IS NULL OR ${alias}."textValue" != $${queryParams.length})`;
      }
      default:
        return null;
    }
  }

  return null;
}
