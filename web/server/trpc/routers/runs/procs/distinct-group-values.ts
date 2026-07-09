import { z } from "zod";
import { protectedOrgProcedure } from "../../../../lib/trpc";
import { getCached, setCached, buildBatchCacheKey } from "../../../../lib/cache";
import {
  parseGroupField,
  SUPPORTED_SYSTEM_GROUP_FIELDS,
  SUPPORTED_TAG_PREFIXES,
  applyGroupFiltersToInput,
  loadGroupFilterDataTypes,
  buildTagPrefixExclusionConditions,
} from "../../../../lib/group-field";
import {
  buildFieldFilterConditions,
  buildSystemFilterConditions,
} from "./list-runs";
import {
  queryMetricFilteredRunIds,
  queryRunMetricValuesByLogName,
} from "../../../../lib/queries/metric-summaries";
import type { MetricAggregation } from "../../../../lib/queries/metric-summaries";

/** 30s — same as distinctTags; bucket values change as runs accumulate. */
const CACHE_TTL = 30 * 1000;

/** Hard ceiling per response so a project with thousands of distinct
 *  config values can't blow up the dropdown. The picker pages through
 *  with `offset` to load more. */
const MAX_LIMIT = 100;

/** Cap on `aggregateColumns.length`. Each entry adds one LEFT JOIN
 *  (for config/sysmeta) or one CTE (for metrics). Comfortably above
 *  any realistic visible-columns count. */
const MAX_AGGREGATE_COLUMNS = 32;

const dateFilterSchema = z.object({
  field: z.enum(["createdAt", "updatedAt", "statusUpdated"]),
  operator: z.enum(["before", "after", "between"]),
  value: z.string().datetime(),
  value2: z.string().datetime().optional(),
});

const fieldFilterSchema = z.object({
  source: z.enum(["config", "systemMetadata"]),
  key: z.string(),
  dataType: z.enum(["text", "number", "date", "option"]),
  operator: z.string(),
  values: z.array(z.any()),
});

const metricFilterSchema = z.object({
  logName: z.string(),
  aggregation: z.enum(["MIN", "MAX", "AVG", "LAST", "VARIANCE"]),
  operator: z.string(),
  values: z.array(z.any()),
});

const systemFilterSchema = z.object({
  field: z.enum(["name", "status", "tags", "creator.name", "notes"]),
  operator: z.string(),
  values: z.array(z.any()),
});

const groupFilterSchema = z.object({
  field: z.string(),
  value: z.string().nullable(),
});

export interface GroupValueRow {
  /** The bucket label. `null` represents the "unset" bucket (runs that
   *  do not have a value for this field). */
  value: string | null;
  /** How many runs fall into this bucket under the current filter set. */
  count: number;
  /** Per-column aggregates, indexed parallel to the caller's
   *  `aggregateColumns` input. Null slot = the column has no
   *  meaningful aggregator (W&B parity: text/status/tags/notes are
   *  blank on group rows). Date aggregates are seconds since epoch.
   *  Metric aggregates are the AVG of each run's per-column
   *  aggregation value (e.g. AVG of LAST(train/loss)). */
  aggregates?: Array<number | null>;
}

export interface DistinctGroupValuesResponse {
  values: GroupValueRow[];
  /** True when there are more rows after the current page — drives the
   *  "load more" affordance in the picker. */
  hasMore: boolean;
  /** Total number of distinct bucket values matching the filter set,
   *  IGNORING limit/offset. Lets the runs-table footer render
   *  `1 / N`-style pagination on top-level groups (wandb parity). For
   *  `tag-prefix` fields this counts the prefix-matching values; the
   *  `(unset)` null bucket is added on top when present at offset=0,
   *  mirroring the values-array behaviour. Adds one extra COUNT query
   *  per request — cheap relative to the main GROUP BY. */
  totalCount: number;
  /** Subgroup breakdown per top-level value, when the caller passes a
   *  `subgroupField` (e.g. `config:batch_size` under a `tag-prefix:group`
   *  parent). Keys are the JSON-stringified parent value (`""` for the
   *  `(unset)` null bucket); each entry holds the full GroupValueRow[]
   *  for the subgroup field under that parent.
   *
   *  Folds the per-parent-row "subgroup probe" queries into the main
   *  bucket query — one SQL roundtrip instead of one-per-parent — and
   *  lets the bucket-tree render `(K subgroups)` badges + hover-dispatch
   *  descendant pathKeys without an extra fetch. Returned only when
   *  `subgroupField` is set; omitted otherwise so existing callers are
   *  unaffected. */
  subgroupsByValue?: Record<string, GroupValueRow[]>;
}

/** Paginated distinct values for a single grouping field, scoped by the
 *  same filter set the runs table uses. The picker calls this once per
 *  nesting level (parentFilters narrow the universe to the parent bucket
 *  the user is drilling into). */
export const distinctGroupValuesProcedure = protectedOrgProcedure
  .input(
    z.object({
      projectName: z.string(),
      /** Encoded group field — e.g. `system:status`, `config:lr`,
       *  `tag-prefix:group`. Validated per request. */
      field: z.string(),
      /** Bucket trail leading to this level — applied as constraints
       *  exactly like the regular filter set. Capped at MAX_GROUP_BY_DEPTH-1
       *  (5-1) since a parent trail can never exceed the grouping depth. */
      parentFilters: z.array(groupFilterSchema).max(4).optional(),
      /** Same filter shape as `runs.list`. Group-value buckets respect
       *  these so the picker reflects the user's current view. */
      search: z.string().optional(),
      tags: z.array(z.string()).optional(),
      status: z.array(z.enum(["RUNNING", "COMPLETED", "FAILED", "TERMINATED", "CANCELLED"])).optional(),
      dateFilters: z.array(dateFilterSchema).optional(),
      fieldFilters: z.array(fieldFilterSchema).optional(),
      metricFilters: z.array(metricFilterSchema).optional(),
      systemFilters: z.array(systemFilterSchema).optional(),
      /** Case-insensitive substring filter on the bucket labels themselves
       *  — drives the "type to search" affordance in the picker. */
      valueSearch: z.string().optional(),
      limit: z.number().int().positive().max(MAX_LIMIT).default(MAX_LIMIT),
      offset: z.number().int().min(0).default(0),
      /** Opt out of LIMIT/OFFSET entirely. Used by callers that need
       *  the full bucket list (e.g. the runs-table parent-row hover
       *  probe, which dispatches every descendant pathKey to the
       *  charts and must therefore know all of them). Bypasses the
       *  MAX_LIMIT cap — caller assumes the cost. When true the
       *  `hasMore` field is always `false` and `totalCount` equals
       *  `values.length`. */
      returnAll: z.boolean().optional(),
      /** Encoded subgroup field — same shape as `field`. When set, the
       *  response includes `subgroupsByValue`: a map from every top-level
       *  value (in this response's `values`) to the GroupValueRow[] of
       *  distinct subgroup values found under that parent. Lets the
       *  bucket-tree render `(K subgroups)` badges + hover-dispatch
       *  descendants without one probe query per parent row. */
      subgroupField: z.string().optional(),
      /** When set, buckets at THIS level (and any subgroup level reached
       *  via `subgroupField`) are ordered by an aggregate of the sort
       *  column across the runs in each bucket — W&B parity for "sort by
       *  group average." `count DESC` becomes the tiebreaker instead of
       *  the primary key.
       *
       *  Aggregator by `sortDataType`:
       *    number / metric → AVG over descendant-run values
       *    date           → AVG of epoch seconds, NULLS LAST
       *    text / option  → MIN (alphabetical first)
       *  Metric sort needs `sortAggregation` (the per-run aggregator on
       *  the metric summary) — `AVG of LAST` is the W&B default. */
      sortField: z.string().optional(),
      sortSource: z.enum(["system", "config", "systemMetadata", "metric"]).optional(),
      sortDirection: z.enum(["asc", "desc"]).optional(),
      sortAggregation: z.enum(["MIN", "MAX", "AVG", "LAST", "VARIANCE"]).optional(),
      // Optional override for config/systemMetadata sort. When omitted,
      // the proc auto-probes `project_column_keys` for the (source, key)
      // pair — keeps the frontend wiring trivial. Only matters when the
      // frontend already knows the dataType and wants to skip the probe.
      sortDataType: z.enum(["text", "number", "date", "option"]).optional(),
      /** Columns the caller wants aggregated per bucket. Powers the W&B-
       *  style values shown on group / subgroup / leaf-group rows. Each
       *  entry is bucket-aggregated with the same rule as `sortField`:
       *  number/metric → AVG, date → AVG(epoch), text/option → null
       *  (blank on group rows). Results land in each
       *  `GroupValueRow.aggregates` in the same order. Capped server-
       *  side to MAX_AGGREGATE_COLUMNS so a runaway visibleColumns
       *  array can't blow up the SQL. */
      aggregateColumns: z.array(z.object({
        source: z.enum(["system", "config", "systemMetadata", "metric"]),
        field: z.string(),
        aggregation: z.enum(["MIN", "MAX", "AVG", "LAST", "VARIANCE"]).optional(),
        dataType: z.enum(["text", "number", "date", "option"]).optional(),
      })).optional(),
    })
  )
  .query(async ({ ctx, input }): Promise<DistinctGroupValuesResponse> => {
    const parsedField = parseGroupField(input.field);
    if (!parsedField) return { values: [], hasMore: false, totalCount: 0 };
    // Re-alias for closures (e.g. `buildAllBuckets` below) — TS narrowing
    // doesn't carry across nested function boundaries, but a const
    // declared post-check is typed as non-null.
    const parsed = parsedField;

    // Validate field kind / key against the allow-list. This keeps the
    // SQL builders honest — we never interpolate untrusted identifiers.
    if (parsed.kind === "system") {
      if (!(SUPPORTED_SYSTEM_GROUP_FIELDS as readonly string[]).includes(parsed.key)) {
        return { values: [], hasMore: false, totalCount: 0 };
      }
    } else if (parsed.kind === "tag-prefix") {
      if (!(SUPPORTED_TAG_PREFIXES as readonly string[]).includes(parsed.key)) {
        return { values: [], hasMore: false, totalCount: 0 };
      }
    }

    const project = await ctx.prisma.projects.findFirst({
      where: { name: input.projectName, organizationId: input.organizationId },
      select: { id: true },
    });
    if (!project) return { values: [], hasMore: false, totalCount: 0 };
    // Re-alias so TS narrowing survives the intervening `await`s
    // inside `fetchPage` / `fetchSubgroups` — otherwise later
    // references to `project.id` re-widen to nullable.
    const projectId: bigint = project.id;

    // Compose parentFilters into the same filter arrays the listing API
    // uses, so the WHERE clause stays in one shape.
    let merged: {
      tags?: string[];
      status?: ("RUNNING" | "COMPLETED" | "FAILED" | "TERMINATED" | "CANCELLED")[];
      fieldFilters?: typeof input.fieldFilters;
      systemFilters?: typeof input.systemFilters;
      tagPrefixExclusions?: string[];
    } = {
      tags: input.tags,
      status: input.status,
      fieldFilters: input.fieldFilters,
      systemFilters: input.systemFilters,
    };
    if (input.parentFilters && input.parentFilters.length > 0) {
      const dataTypes = await loadGroupFilterDataTypes(ctx.prisma, project.id, input.parentFilters);
      merged = applyGroupFiltersToInput(merged, input.parentFilters, dataTypes);
    }

    // Cache per (filter-set, limit, offset). SQL paginates so we don't
    // pull the full bucket list into memory — supports unlimited
    // distinct group values without OOM risk on the backend.
    const cacheKey = buildBatchCacheKey("distinctGroupValues", {
      orgId: input.organizationId,
      projectId: project.id.toString(),
      field: input.field,
      parentFilters: JSON.stringify(input.parentFilters ?? []),
      search: input.search ?? "",
      tags: merged.tags ?? [],
      status: merged.status ?? [],
      dateFilters: JSON.stringify(input.dateFilters ?? []),
      fieldFilters: JSON.stringify(merged.fieldFilters ?? []),
      metricFilters: JSON.stringify(input.metricFilters ?? []),
      systemFilters: JSON.stringify(merged.systemFilters ?? []),
      valueSearch: input.valueSearch ?? "",
      // returnAll callers (parent-row hover probe) get the full
      // bucket list — cache that under a distinct key so it doesn't
      // collide with paginated fetches over the same filter set.
      limit: input.returnAll ? "__all__" : input.limit,
      offset: input.returnAll ? 0 : input.offset,
      subgroupField: input.subgroupField ?? "",
      // Sort changes bucket ordering — DON'T let an unsorted result get
      // served for a sorted request (or vice versa). Folded into one
      // sub-key so a no-sort request hits the same cache key as before.
      sort: input.sortField && input.sortSource && input.sortDirection
        ? `${input.sortSource}:${input.sortField}:${input.sortDirection}:${input.sortAggregation ?? ""}:${input.sortDataType ?? ""}`
        : "",
      // Aggregate columns flow into the SELECT list — same cache-key
      // discipline as sort. Truncated to the cap so a misbehaving
      // caller can't pollute Redis with a forever-novel key.
      aggs: JSON.stringify((input.aggregateColumns ?? []).slice(0, MAX_AGGREGATE_COLUMNS)),
    });
    const cached = await getCached<DistinctGroupValuesResponse>(cacheKey);
    if (cached) return cached;

    // CH metric pre-fetches at procedure scope so BOTH fetchPage and
    // fetchSubgroups reuse the same per-run-value rows. One round trip
    // for the sort column (if it's a metric); one parallel batch for
    // every metric in `aggregateColumns`.
    const prefetchedMetricValues = await prefetchSortRunMetricValues(input, ctx);
    const prefetchedAggMetricValues = await prefetchAggregateMetricValues(input, ctx);

    // Resolve dataType for config/sysmeta sort fields when the caller
    // didn't provide one. project_column_keys carries it for every
    // (source, key) the project has logged — one tiny indexed lookup.
    let resolvedSortDataType: "text" | "number" | "date" | "option" | undefined = input.sortDataType;
    if (
      !resolvedSortDataType &&
      input.sortField &&
      (input.sortSource === "config" || input.sortSource === "systemMetadata")
    ) {
      const row = await ctx.prisma.projectColumnKey.findUnique({
        where: {
          projectId_source_key: {
            projectId,
            source: input.sortSource,
            key: input.sortField,
          },
        },
        select: { dataType: true },
      });
      // PG stores "text" | "number" | "date" as plain strings.
      const dt = row?.dataType as ("text" | "number" | "date" | undefined);
      if (dt === "text" || dt === "number" || dt === "date") {
        resolvedSortDataType = dt;
      }
    }
    const sortInputResolved = { ...input, sortDataType: resolvedSortDataType };

    const result = await fetchPage();
    await setCached(cacheKey, result, CACHE_TTL);
    return result;

    // Builds the page for this filter set with SQL-side pagination.
    // Uses a UNION ALL CTE for the (unset) null bucket so it
    // participates in the same `count DESC, value ASC NULLS LAST`
    // ordering as the main GROUP BY result — wandb-style placement
    // (slots in by its run count, no longer pinned to page 1).
    async function fetchPage(): Promise<DistinctGroupValuesResponse> {

    // ── Build the base WHERE shared by all field kinds ────────────────
    const conditions: string[] = [];
    const queryParams: (string | bigint | string[] | number)[] = [];

    queryParams.push(input.projectName);
    conditions.push(`p."name" = $${queryParams.length}`);

    queryParams.push(input.organizationId);
    conditions.push(`r."organizationId" = $${queryParams.length}`);

    if (input.search && input.search.trim()) {
      // Name/displayId substring; mirrors run-search.ts but simpler —
      // distinct-values isn't a primary search endpoint.
      const q = input.search.trim();
      queryParams.push(q);
      conditions.push(`(r."name" ILIKE '%' || $${queryParams.length} || '%')`);
    }

    if (merged.tags && merged.tags.length > 0) {
      queryParams.push(merged.tags);
      conditions.push(`r."tags" && $${queryParams.length}::text[]`);
    }

    if (merged.status && merged.status.length > 0) {
      queryParams.push(merged.status as unknown as string[]);
      conditions.push(`r."status" = ANY($${queryParams.length}::"RunStatus"[])`);
    }

    if (input.dateFilters?.length) {
      for (const df of input.dateFilters) {
        if (df.operator === "before") {
          queryParams.push(df.value);
          conditions.push(`r."${df.field}" < $${queryParams.length}::timestamptz`);
        } else if (df.operator === "after") {
          queryParams.push(df.value);
          conditions.push(`r."${df.field}" > $${queryParams.length}::timestamptz`);
        } else if (df.operator === "between" && df.value2) {
          queryParams.push(df.value);
          conditions.push(`r."${df.field}" >= $${queryParams.length}::timestamptz`);
          queryParams.push(df.value2);
          conditions.push(`r."${df.field}" <= $${queryParams.length}::timestamptz`);
        }
      }
    }

    buildFieldFilterConditions(conditions, queryParams, merged.fieldFilters, { organizationId: input.organizationId, projectName: input.projectName });
    buildTagPrefixExclusionConditions(conditions, queryParams, merged.tagPrefixExclusions);

    if (input.metricFilters?.length) {
      const mfRunIds = await queryMetricFilteredRunIds(ctx.clickhouse, {
        organizationId: input.organizationId,
        projectName: input.projectName,
        metricFilters: input.metricFilters,
      });
      // Early-return: zero matching runs means no buckets.
      if (mfRunIds.length === 0) return { values: [], hasMore: false, totalCount: 0 };
      // Cast through any: queryParams' element type doesn't include
      // bigint[], but the raw-SQL paths in list-runs/runs-count use the
      // same trick. PG's $N bind accepts an array.
      queryParams.push(mfRunIds.map((id) => BigInt(id)) as any);
      conditions.push(`r.id = ANY($${queryParams.length}::bigint[])`);
    }

    let needsCreatorJoin = false;
    if (merged.systemFilters?.length) {
      const sysResult = buildSystemFilterConditions(conditions, queryParams, merged.systemFilters);
      needsCreatorJoin = sysResult.needsCreatorJoin;
    }

    // Snapshot of conditions that are SHARED between the main query
    // and the (unset) UNION branch. Captured before the per-field
    // extras get appended below. The null branch reuses these
    // verbatim — same $N indices, no parameter duplication.
    const sharedConditions = [...conditions];

    // ── Per-field value expression + GROUP BY ─────────────────────────
    let valueExpr: string;
    let extraJoin = "";
    let extraWhere = "";
    // Tracked separately so the null UNION branch can reference the
    // same prefix parameter index for its NOT EXISTS check. Null for
    // non-tag-prefix kinds.
    let tagPrefixParamIdx: number | null = null;

    if (parsed.kind === "system") {
      if (parsed.key === "status") {
        valueExpr = `r."status"::text`;
      } else if (parsed.key === "name") {
        valueExpr = `r."name"`;
      } else {
        // "creator.name" — fall back to creator email when name is missing.
        extraJoin = `LEFT JOIN "user" gu ON r."createdById" = gu.id`;
        valueExpr = `COALESCE(gu."name", gu."email")`;
      }
    } else if (parsed.kind === "config" || parsed.kind === "systemMetadata") {
      queryParams.push(parsed.kind);
      const sourceIdx = queryParams.length;
      queryParams.push(parsed.key);
      const keyIdx = queryParams.length;
      extraJoin =
        `LEFT JOIN "run_field_values" grfv ` +
        `ON grfv."runId" = r.id AND grfv."source" = $${sourceIdx} AND grfv."key" = $${keyIdx}`;
      // Coalesce text + numeric → string so the GROUP BY collapses both
      // types into a single bucket per distinct value.
      valueExpr = `COALESCE(grfv."textValue", grfv."numericValue"::text)`;
    } else {
      // tag-prefix:<prefix>
      const prefix = `${parsed.key}:`;
      queryParams.push(prefix);
      const prefixIdx = queryParams.length;
      tagPrefixParamIdx = prefixIdx;
      extraJoin = `CROSS JOIN UNNEST(r.tags) AS gtag`;
      extraWhere = `gtag LIKE $${prefixIdx} || '%'`;
      valueExpr = `SUBSTRING(gtag FROM LENGTH($${prefixIdx}) + 1)`;
    }

    if (needsCreatorJoin && parsed.key !== "creator.name") {
      extraJoin = `LEFT JOIN "user" u ON r."createdById" = u.id ${extraJoin}`;
    } else if (needsCreatorJoin && parsed.key === "creator.name") {
      // distinct-group-values is already joining for the value
      // expression — reuse that alias.
      extraJoin = extraJoin.replace("LEFT JOIN \"user\" gu", "LEFT JOIN \"user\" u");
      // Keep the value expression pointing at the same alias.
      valueExpr = valueExpr.replace(/gu/g, "u");
    }

    // ── Per-bucket sort aggregate (W&B parity: order groups by the
    //    aggregate of the sort column over their descendant runs) ──────
    //
    // Returns a self-contained set of fragments that get spliced into
    // both the main GROUP BY branch AND the (unset) tag-prefix branch
    // so the union sorts consistently. When sort is unset (or sort
    // can't be applied, e.g. unsupported system field), all four
    // fragments are empty and behaviour collapses to the legacy
    // `count DESC, value ASC NULLS LAST` order.
    //
    // `prefetchedMetricValues` was fetched at procedure scope (above)
    // so both the main query and the subgroups query share the same
    // CH round-trip.
    const {
      sortJoin,
      sortAggSelect,
      sortOuterSelect,
      sortOrderExpr,
      runMetricsCte,
    } = buildBucketSortFragments(sortInputResolved, queryParams, parsed, prefetchedMetricValues);

    // Per-column aggregates (W&B group-row values). Same aggregator
    // rules as sort; text/option/status columns come back as null
    // slots and the frontend leaves the cell blank.
    const {
      aggJoins,
      aggSelects,
      aggOuterSelects,
      aggMetricCtes,
      aggResolved,
    } = await buildBucketColumnAggregateFragments(
      input.aggregateColumns ?? [],
      queryParams,
      ctx,
      projectId,
      prefetchedAggMetricValues,
    );

    if (extraWhere) conditions.push(extraWhere);

    if (input.valueSearch && input.valueSearch.trim()) {
      const escaped = input.valueSearch.trim().replace(/[\\%_]/g, (c) => `\\${c}`);
      queryParams.push(`%${escaped}%`);
      conditions.push(`(${valueExpr}) ILIKE $${queryParams.length}`);
    }

    const mainWhereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    // (unset) null-bucket UNION branch — included only for tag-prefix
    // fields with no valueSearch active. Reuses the sharedConditions
    // verbatim (same $N indices the main branch already pushed) plus
    // a NOT EXISTS on the SAME prefix param. No extra parameter copies.
    const unsetEnabled =
      parsed.kind === "tag-prefix" &&
      !(input.valueSearch && input.valueSearch.trim()) &&
      tagPrefixParamIdx !== null;
    const unsetUnion = unsetEnabled
      ? `
        UNION ALL
        SELECT NULL::text AS value, COUNT(*)::int AS count${sortAggSelect}${aggSelects}
        FROM "runs" r
        JOIN "projects" p ON r."projectId" = p."id"
        ${sortJoin}
        ${aggJoins}
        WHERE ${sharedConditions.join(" AND ")}
          AND NOT EXISTS (SELECT 1 FROM UNNEST(r.tags) AS t WHERE t LIKE $${tagPrefixParamIdx} || '%')
        HAVING COUNT(*) > 0
      `
      : "";

    // returnAll callers (parent-row hover probe) skip LIMIT/OFFSET so
    // they get every descendant bucket in one query. Paginated callers
    // (footer-driven top-level + nested levels) still LIMIT $X OFFSET
    // $Y as before.
    let limitOffsetClause = "";
    let limitIdx = 0; // tracked for the empty-page COUNT fallback below
    if (!input.returnAll) {
      queryParams.push(input.limit + 1);
      limitIdx = queryParams.length;
      queryParams.push(input.offset);
      const offsetIdx = queryParams.length;
      limitOffsetClause = `LIMIT $${limitIdx} OFFSET $${offsetIdx}`;
    }

    // CTE puts main + (unset) on equal footing, then the outer SELECT
    // sorts and paginates across the union. `COUNT(*) OVER ()` runs
    // after the CTE materialises but before LIMIT/OFFSET, so each
    // returned row carries the total bucket count for "1 / N" footer.
    // ORDER BY uses NULLS LAST so when (unset) ties on count with a
    // named bucket, the named one wins the slot — matches wandb.
    const sql = `
      WITH ${runMetricsCte}${aggMetricCtes}all_buckets AS (
        SELECT
          ${valueExpr} AS value,
          COUNT(DISTINCT r.id)::int AS count${sortAggSelect}${aggSelects}
        FROM "runs" r
        JOIN "projects" p ON r."projectId" = p."id"
        ${extraJoin}
        ${sortJoin}
        ${aggJoins}
        ${mainWhereClause}
        GROUP BY value
        ${unsetUnion}
      )
      SELECT
        value,
        count,${sortOuterSelect}${aggOuterSelects}
        COUNT(*) OVER ()::int AS total_count
      FROM all_buckets
      ORDER BY ${sortOrderExpr}count DESC, value ASC NULLS LAST
      ${limitOffsetClause}
    `;

    // Rows pick up `agg_0`, `agg_1`, ... columns when aggregateColumns
    // is non-empty; we project them back into `aggregates` in input
    // order using `aggResolved.length`.
    type Row = { value: string | null; count: number; total_count: number } & Record<string, unknown>;
    const rows = await ctx.prisma.$queryRawUnsafe<Row[]>(sql, ...queryParams);

    const hasMore = !input.returnAll && rows.length > input.limit;
    const trimmed = hasMore ? rows.slice(0, input.limit) : rows;
    const values: GroupValueRow[] = trimmed.map((r) => {
      const row: GroupValueRow = { value: r.value, count: r.count };
      if (aggResolved.length > 0) {
        const aggregates: Array<number | null> = [];
        for (let i = 0; i < aggResolved.length; i++) {
          if (aggResolved[i] === null) {
            aggregates.push(null);
            continue;
          }
          const raw = r[`agg_${i}`];
          aggregates.push(raw == null ? null : Number(raw));
        }
        row.aggregates = aggregates;
      }
      return row;
    });
    // Window function value is the same on every row, but offset-past-
    // end pages return zero rows. In that edge case, fire a single
    // dedicated COUNT(*) over the CTE so the footer still gets the
    // right total instead of falling back to 0 / "Page N".
    let totalCount: number;
    if (rows.length > 0) {
      totalCount = rows[0].total_count;
    } else if (input.returnAll) {
      // returnAll with no rows = no buckets exist for this filter set.
      // The empty-page fallback below is only meaningful when an offset
      // has stepped past the end; that can't happen here.
      totalCount = 0;
    } else {
      const countSql = `
        WITH ${runMetricsCte}${aggMetricCtes}all_buckets AS (
          SELECT
            ${valueExpr} AS value,
            COUNT(DISTINCT r.id)::int AS count${sortAggSelect}${aggSelects}
          FROM "runs" r
          JOIN "projects" p ON r."projectId" = p."id"
          ${extraJoin}
          ${sortJoin}
          ${aggJoins}
          ${mainWhereClause}
          GROUP BY value
          ${unsetUnion}
        )
        SELECT COUNT(*)::int AS total FROM all_buckets
      `;
      // Same params minus the trailing limit + offset we appended above.
      const countParams = queryParams.slice(0, limitIdx - 1);
      const countRow = await ctx.prisma.$queryRawUnsafe<{ total: number }[]>(
        countSql,
        ...countParams,
      );
      totalCount = countRow[0]?.total ?? 0;
    }

    // Subgroup breakdown. When the caller passes `subgroupField`, run a
    // SECOND query that groups by (parent_value, subgroup_value) limited
    // to THIS page's parent values. Folds N per-parent-row probe queries
    // into one — saves N HTTP roundtrips and N SQL invocations on every
    // bucket-tree render with >1 grouping level.
    let subgroupsByValue: Record<string, GroupValueRow[]> | undefined;
    if (input.subgroupField && values.length > 0) {
      subgroupsByValue = await fetchSubgroups(values.map((v) => v.value));
    }
    return { values, hasMore, totalCount, subgroupsByValue };
    }

    // Build a (parent_value → GroupValueRow[]) map for the given page
    // of parent values. Reuses the same filter-set logic as the parent
    // query but adds:
    //   - a JOIN/expression for the subgroup field
    //   - a parent-value-in-page constraint so we only return subgroups
    //     under buckets the caller actually rendered (not every bucket
    //     in the project — that would defeat the purpose of pagination)
    // Returns `undefined` keys mapped to "" for the null bucket, matching
    // how the frontend serialises filter trails.
    async function fetchSubgroups(
      pageParentValues: (string | null)[],
    ): Promise<Record<string, GroupValueRow[]>> {
      const subParsed = parseGroupField(input.subgroupField!);
      if (!subParsed) return {};
      if (subParsed.kind === "system") {
        if (!(SUPPORTED_SYSTEM_GROUP_FIELDS as readonly string[]).includes(subParsed.key)) return {};
      } else if (subParsed.kind === "tag-prefix") {
        if (!(SUPPORTED_TAG_PREFIXES as readonly string[]).includes(subParsed.key)) return {};
      }

      // Rebuild shared WHERE/JOIN from scratch with our own param indices.
      // The main query's `queryParams` are already laid out for the
      // already-executed SQL; reusing would tangle indices.
      const sConditions: string[] = [];
      const sParams: (string | bigint | string[] | number)[] = [];

      sParams.push(input.projectName);
      sConditions.push(`p."name" = $${sParams.length}`);
      sParams.push(input.organizationId);
      sConditions.push(`r."organizationId" = $${sParams.length}`);

      if (input.search && input.search.trim()) {
        sParams.push(input.search.trim());
        sConditions.push(`(r."name" ILIKE '%' || $${sParams.length} || '%')`);
      }
      if (merged.tags && merged.tags.length > 0) {
        sParams.push(merged.tags);
        sConditions.push(`r."tags" && $${sParams.length}::text[]`);
      }
      if (merged.status && merged.status.length > 0) {
        sParams.push(merged.status as unknown as string[]);
        sConditions.push(`r."status" = ANY($${sParams.length}::"RunStatus"[])`);
      }
      if (input.dateFilters?.length) {
        for (const df of input.dateFilters) {
          if (df.operator === "before") {
            sParams.push(df.value);
            sConditions.push(`r."${df.field}" < $${sParams.length}::timestamptz`);
          } else if (df.operator === "after") {
            sParams.push(df.value);
            sConditions.push(`r."${df.field}" > $${sParams.length}::timestamptz`);
          } else if (df.operator === "between" && df.value2) {
            sParams.push(df.value);
            sConditions.push(`r."${df.field}" >= $${sParams.length}::timestamptz`);
            sParams.push(df.value2);
            sConditions.push(`r."${df.field}" <= $${sParams.length}::timestamptz`);
          }
        }
      }
      buildFieldFilterConditions(sConditions, sParams, merged.fieldFilters, { organizationId: input.organizationId, projectName: input.projectName });
      buildTagPrefixExclusionConditions(sConditions, sParams, merged.tagPrefixExclusions);

      // metricFilters: reuse the run-id set if needed. Re-run is cheap
      // because clickhouse hot-caches the metric summaries.
      if (input.metricFilters?.length) {
        const mfRunIds = await queryMetricFilteredRunIds(ctx.clickhouse, {
          organizationId: input.organizationId,
          projectName: input.projectName,
          metricFilters: input.metricFilters,
        });
        if (mfRunIds.length === 0) return {};
        sParams.push(mfRunIds.map((id) => BigInt(id)) as any);
        sConditions.push(`r.id = ANY($${sParams.length}::bigint[])`);
      }

      let sNeedsCreatorJoin = false;
      if (merged.systemFilters?.length) {
        const sysRes = buildSystemFilterConditions(sConditions, sParams, merged.systemFilters);
        sNeedsCreatorJoin = sysRes.needsCreatorJoin;
      }

      // Parent value expression (same logic as main query, fresh indices).
      let parentExpr: string;
      let parentJoin = "";
      let parentExtraWhere = "";
      let parentTagPrefixIdx: number | null = null;
      if (parsed.kind === "system") {
        if (parsed.key === "status") parentExpr = `r."status"::text`;
        else if (parsed.key === "name") parentExpr = `r."name"`;
        else {
          parentJoin = `LEFT JOIN "user" gu_p ON r."createdById" = gu_p.id`;
          parentExpr = `COALESCE(gu_p."name", gu_p."email")`;
        }
      } else if (parsed.kind === "config" || parsed.kind === "systemMetadata") {
        sParams.push(parsed.kind);
        const psIdx = sParams.length;
        sParams.push(parsed.key);
        const pkIdx = sParams.length;
        parentJoin = `LEFT JOIN "run_field_values" grfv_p ON grfv_p."runId" = r.id AND grfv_p."source" = $${psIdx} AND grfv_p."key" = $${pkIdx}`;
        parentExpr = `COALESCE(grfv_p."textValue", grfv_p."numericValue"::text)`;
      } else {
        const pPrefix = `${parsed.key}:`;
        sParams.push(pPrefix);
        parentTagPrefixIdx = sParams.length;
        parentJoin = `CROSS JOIN UNNEST(r.tags) AS gtag_p`;
        parentExtraWhere = `gtag_p LIKE $${parentTagPrefixIdx} || '%'`;
        parentExpr = `SUBSTRING(gtag_p FROM LENGTH($${parentTagPrefixIdx}) + 1)`;
      }

      // Subgroup value expression.
      let subExpr: string;
      let subJoin = "";
      let subExtraWhere = "";
      let subTagPrefixIdx: number | null = null;
      if (subParsed.kind === "system") {
        if (subParsed.key === "status") subExpr = `r."status"::text`;
        else if (subParsed.key === "name") subExpr = `r."name"`;
        else {
          subJoin = `LEFT JOIN "user" gu_s ON r."createdById" = gu_s.id`;
          subExpr = `COALESCE(gu_s."name", gu_s."email")`;
        }
      } else if (subParsed.kind === "config" || subParsed.kind === "systemMetadata") {
        sParams.push(subParsed.kind);
        const ssIdx = sParams.length;
        sParams.push(subParsed.key);
        const skIdx = sParams.length;
        subJoin = `LEFT JOIN "run_field_values" grfv_s ON grfv_s."runId" = r.id AND grfv_s."source" = $${ssIdx} AND grfv_s."key" = $${skIdx}`;
        subExpr = `COALESCE(grfv_s."textValue", grfv_s."numericValue"::text)`;
      } else {
        // tag-prefix subgroup under a tag-prefix parent would cartesian-
        // join the same tags array. Skip — frontend falls back to its
        // own probe call for this (rare) shape.
        if (parsed.kind === "tag-prefix") return {};
        const sPrefix = `${subParsed.key}:`;
        sParams.push(sPrefix);
        subTagPrefixIdx = sParams.length;
        subJoin = `CROSS JOIN UNNEST(r.tags) AS gtag_s`;
        subExtraWhere = `gtag_s LIKE $${subTagPrefixIdx} || '%'`;
        subExpr = `SUBSTRING(gtag_s FROM LENGTH($${subTagPrefixIdx}) + 1)`;
      }

      // Creator join — at most once, reused by either expression.
      let creatorJoin = "";
      if (sNeedsCreatorJoin && parsed.key !== "creator.name" && subParsed.key !== "creator.name") {
        creatorJoin = `LEFT JOIN "user" u ON r."createdById" = u.id`;
      }

      const extraWhereClauses: string[] = [];
      if (parentExtraWhere) extraWhereClauses.push(parentExtraWhere);
      if (subExtraWhere) extraWhereClauses.push(subExtraWhere);

      // Constrain to this page's parent values (string array — null
      // values are matched separately because PG's = ANY doesn't match
      // NULL elements).
      const nonNullParents = pageParentValues.filter((v): v is string => v !== null);
      const includeNull = pageParentValues.includes(null);
      if (nonNullParents.length > 0) {
        sParams.push(nonNullParents);
        const inIdx = sParams.length;
        if (includeNull) {
          extraWhereClauses.push(`((${parentExpr}) = ANY($${inIdx}::text[]) OR (${parentExpr}) IS NULL)`);
        } else {
          extraWhereClauses.push(`(${parentExpr}) = ANY($${inIdx}::text[])`);
        }
      } else if (includeNull) {
        extraWhereClauses.push(`(${parentExpr}) IS NULL`);
      } else {
        // No parents → nothing to fetch.
        return {};
      }

      const allConditions = [...sConditions, ...extraWhereClauses];
      const whereClause = allConditions.length > 0 ? `WHERE ${allConditions.join(" AND ")}` : "";

      // Same sort wiring as the main bucket query — subgroups must
      // mirror their parent's ordering rule so the recursive "W&B
      // sort by descendant aggregate" is uniform at every depth.
      // Reuses the CH metric pre-fetch from fetchPage so we don't
      // round-trip ClickHouse twice per request.
      const subSortFragments = buildBucketSortFragments(
        sortInputResolved,
        sParams,
        subParsed,
        prefetchedMetricValues,
      );

      // Column aggregates for the subgroup rows. Fresh fragments own
      // their own $N indices in sParams, reusing the same pre-fetched
      // CH data as the main-bucket query.
      const subAgg = await buildBucketColumnAggregateFragments(
        input.aggregateColumns ?? [],
        sParams,
        ctx,
        projectId,
        prefetchedAggMetricValues,
      );

      const sql = `
        WITH ${subSortFragments.runMetricsCte}${subAgg.aggMetricCtes}sub_pairs AS (
          SELECT
            ${parentExpr} AS parent_value,
            ${subExpr} AS subgroup_value,
            COUNT(DISTINCT r.id)::int AS count${subSortFragments.sortAggSelect}${subAgg.aggSelects}
          FROM "runs" r
          JOIN "projects" p ON r."projectId" = p."id"
          ${creatorJoin}
          ${parentJoin}
          ${subJoin}
          ${subSortFragments.sortJoin}
          ${subAgg.aggJoins}
          ${whereClause}
          GROUP BY parent_value, subgroup_value
        )
        SELECT parent_value, subgroup_value, count${subAgg.aggOuterSelects === "" ? "" : `,${subAgg.aggOuterSelects.replace(/,\s*$/, "")}`}
        FROM sub_pairs
        ORDER BY parent_value, ${subSortFragments.sortOrderExpr}count DESC, subgroup_value ASC NULLS LAST
      `;
      type PairRow = {
        parent_value: string | null;
        subgroup_value: string | null;
        count: number;
      } & Record<string, unknown>;
      const rows = await ctx.prisma.$queryRawUnsafe<PairRow[]>(sql, ...sParams);

      const out: Record<string, GroupValueRow[]> = {};
      for (const row of rows) {
        const key = row.parent_value ?? "";
        let arr = out[key];
        if (!arr) {
          arr = [];
          out[key] = arr;
        }
        const sgRow: GroupValueRow = { value: row.subgroup_value, count: row.count };
        if (subAgg.aggResolved.length > 0) {
          const aggregates: Array<number | null> = [];
          for (let i = 0; i < subAgg.aggResolved.length; i++) {
            if (subAgg.aggResolved[i] === null) { aggregates.push(null); continue; }
            const raw = row[`agg_${i}`];
            aggregates.push(raw == null ? null : Number(raw));
          }
          sgRow.aggregates = aggregates;
        }
        arr.push(sgRow);
      }

      // Tag-prefix parent + (unset) bucket: the CROSS JOIN UNNEST above
      // discards runs that have NO matching `${prefix}*` tag, so the
      // main query never returns parent_value = NULL. The frontend's
      // null bucket would then fall back to a probe. Fix by running a
      // dedicated second query for the null parent, using NOT EXISTS
      // to match runs without the tag. Doesn't apply when subgroup is
      // also tag-prefix (we skipped that shape entirely above).
      if (
        includeNull &&
        parsed.kind === "tag-prefix" &&
        parentTagPrefixIdx !== null
      ) {
        // Reuse the SAME params already pushed (sConditions + sub-side
        // joins), append a NOT EXISTS that references the existing
        // tag-prefix param index — no new params needed.
        // ⚠️ Strip the parent-side extraWhereClause and JOIN (the CROSS
        // JOIN that filters to matching tags is the whole problem).
        const nullConditions = [...sConditions];
        if (subExtraWhere) nullConditions.push(subExtraWhere);
        nullConditions.push(
          `NOT EXISTS (SELECT 1 FROM UNNEST(r.tags) AS t WHERE t LIKE $${parentTagPrefixIdx} || '%')`,
        );
        const nullWhere = nullConditions.length > 0 ? `WHERE ${nullConditions.join(" AND ")}` : "";
        // Reuse the sort fragments built for the main subgroups branch
        // — the sort params were already pushed to sParams, calling
        // the builder again would double-push.
        // Reuse the sort + agg fragments built for the main branch —
        // the params were already pushed to sParams; calling the
        // builders again would double-push.
        const nullSql = `
          WITH ${subSortFragments.runMetricsCte}${subAgg.aggMetricCtes}sub_null AS (
            SELECT
              ${subExpr} AS subgroup_value,
              COUNT(DISTINCT r.id)::int AS count${subSortFragments.sortAggSelect}${subAgg.aggSelects}
            FROM "runs" r
            JOIN "projects" p ON r."projectId" = p."id"
            ${creatorJoin}
            ${subJoin}
            ${subSortFragments.sortJoin}
            ${subAgg.aggJoins}
            ${nullWhere}
            GROUP BY subgroup_value
          )
          SELECT subgroup_value, count${subAgg.aggOuterSelects === "" ? "" : `,${subAgg.aggOuterSelects.replace(/,\s*$/, "")}`} FROM sub_null
          ORDER BY ${subSortFragments.sortOrderExpr}count DESC, subgroup_value ASC NULLS LAST
        `;
        type NullRow = { subgroup_value: string | null; count: number } & Record<string, unknown>;
        const nullRows = await ctx.prisma.$queryRawUnsafe<NullRow[]>(nullSql, ...sParams);
        if (nullRows.length > 0) {
          out[""] = nullRows.map((r) => {
            const row: GroupValueRow = { value: r.subgroup_value, count: r.count };
            if (subAgg.aggResolved.length > 0) {
              const aggregates: Array<number | null> = [];
              for (let i = 0; i < subAgg.aggResolved.length; i++) {
                if (subAgg.aggResolved[i] === null) { aggregates.push(null); continue; }
                const raw = r[`agg_${i}`];
                aggregates.push(raw == null ? null : Number(raw));
              }
              row.aggregates = aggregates;
            }
            return row;
          });
        } else {
          // Empty array still shorts the probe — the frontend treats
          // `precomputedSubgroups !== undefined` as "use this, skip probe."
          out[""] = [];
        }
      }
      return out;
    }
  });

/** Allow-list for system sort columns. Mirrors `SYSTEM_SORT_FIELDS` in
 *  list-runs.ts and adds the text-only `status`/`creator.name` that
 *  group sort also needs to handle. Values map to the SQL column / expr
 *  the aggregator wraps. Anything outside this list is silently dropped
 *  back to the default count-desc order — no injection vector. */
const SORT_SYSTEM_EXPRS: Record<string, { expr: string; kind: "text" | "date"; needsCreatorJoin?: boolean }> = {
  name: { expr: `r."name"`, kind: "text" },
  status: { expr: `r."status"::text`, kind: "text" },
  notes: { expr: `r."notes"`, kind: "text" },
  createdAt: { expr: `r."createdAt"`, kind: "date" },
  updatedAt: { expr: `r."updatedAt"`, kind: "date" },
  statusUpdated: { expr: `r."statusUpdated"`, kind: "date" },
  "creator.name": { expr: `COALESCE(usort."name", usort."email")`, kind: "text", needsCreatorJoin: true },
};

interface BucketSortFragments {
  /** Extra LEFT JOIN to add inside the CTE (both branches). Empty when
   *  no sort is active or the sort uses a column already reachable from
   *  `runs` (e.g. system columns). */
  sortJoin: string;
  /** ", AVG(...) AS sort_agg" — appended to the SELECT inside the CTE.
   *  Empty when sort is unset. */
  sortAggSelect: string;
  /** "sort_agg," — appended to the outer SELECT so the value falls
   *  through to ORDER BY. Empty when sort is unset. */
  sortOuterSelect: string;
  /** "sort_agg DESC NULLS LAST, " — prepended to ORDER BY. Empty when
   *  sort is unset (falls through to existing `count DESC, value ASC`). */
  sortOrderExpr: string;
  /** "run_metrics AS (...), " — prepended to the WITH clause when
   *  metric sort needs a per-run-value injection from ClickHouse. */
  runMetricsCte: string;
}

const EMPTY_SORT_FRAGMENTS: BucketSortFragments = {
  sortJoin: "",
  sortAggSelect: "",
  sortOuterSelect: "",
  sortOrderExpr: "",
  runMetricsCte: "",
};

/** ClickHouse round-trip cache for metric sort. Fired ONCE per request
 *  and reused by the main bucket query + the subgroups query so we
 *  don't hit CH twice for the same `(logName, aggregation)`. `null`
 *  when sort isn't on a metric column. */
type PrefetchedMetricValues = { runIds: bigint[]; vals: number[] } | null;

async function prefetchSortRunMetricValues(
  input: {
    organizationId: string;
    projectName: string;
    sortField?: string;
    sortSource?: "system" | "config" | "systemMetadata" | "metric";
    sortAggregation?: MetricAggregation;
  },
  // Loose-typed to match the rest of this file's `ctx.prisma`/`ctx.clickhouse`
  // usage — `@clickhouse/client`'s type isn't re-exported by the helper layer.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ctx: { clickhouse: any },
): Promise<PrefetchedMetricValues> {
  if (input.sortSource !== "metric" || !input.sortField) return null;
  const aggregation = (input.sortAggregation ?? "LAST") as MetricAggregation;
  const rows = await queryRunMetricValuesByLogName(ctx.clickhouse, {
    organizationId: input.organizationId,
    projectName: input.projectName,
    logName: input.sortField,
    aggregation,
  });
  return {
    runIds: rows.map((r) => BigInt(r.runId)),
    vals: rows.map((r) => Number(r.value)),
  };
}

/** Build the per-bucket sort aggregate. See the call-site comment in
 *  `fetchPage` for the W&B parity rationale.
 *
 *  Aggregator pick by `sortSource` / `sortDataType`:
 *    metric                 → AVG(per-run aggregation value)
 *    number                 → AVG(numericValue)
 *    date                   → AVG(EXTRACT(EPOCH FROM …))
 *    text / option / status → MIN(...)  (alphabetical first)
 *
 *  The bucket query already JOINs `extraJoin` for the bucket field; we
 *  add a SEPARATE alias (`rs` / `usort` / `run_metrics`) so the sort
 *  source can be a totally different column from the bucket field.
 */
function buildBucketSortFragments(
  input: {
    sortField?: string;
    sortSource?: "system" | "config" | "systemMetadata" | "metric";
    sortDirection?: "asc" | "desc";
    sortDataType?: "text" | "number" | "date" | "option";
  },
  queryParams: (string | bigint | string[] | number)[],
  parsedBucketField: ReturnType<typeof parseGroupField>,
  prefetchedMetricValues: PrefetchedMetricValues,
): BucketSortFragments {
  const { sortField, sortSource, sortDirection } = input;
  if (!sortField || !sortSource || !sortDirection) return EMPTY_SORT_FRAGMENTS;
  const dir = sortDirection === "asc" ? "ASC" : "DESC";
  const order = `sort_agg ${dir} NULLS LAST, `;

  if (sortSource === "metric") {
    // Empty CH response (metric doesn't exist for this project): all
    // bucket sort_aggs end up NULL → NULLS LAST drops to the count
    // tiebreaker. Still inject the empty CTE so the SQL stays valid.
    const runIds = prefetchedMetricValues?.runIds ?? [];
    const vals = prefetchedMetricValues?.vals ?? [];
    // queryParams's element type doesn't include bigint[]/number[]; the
    // metric-filter path (`r.id = ANY($N::bigint[])`) uses the same
    // `as any` escape hatch.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    queryParams.push(runIds as any);
    const idsIdx = queryParams.length;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    queryParams.push(vals as any);
    const valsIdx = queryParams.length;
    const runMetricsCte =
      `run_metrics AS (SELECT * FROM UNNEST($${idsIdx}::bigint[], $${valsIdx}::double precision[]) AS t(run_id, metric_val)), `;
    return {
      sortJoin: `LEFT JOIN run_metrics rm ON rm.run_id = r.id`,
      sortAggSelect: `, AVG(rm.metric_val) AS sort_agg`,
      sortOuterSelect: ` sort_agg,`,
      sortOrderExpr: order,
      runMetricsCte,
    };
  }

  if (sortSource === "system") {
    const sys = SORT_SYSTEM_EXPRS[sortField];
    if (!sys) return EMPTY_SORT_FRAGMENTS;
    const aggExpr =
      sys.kind === "date"
        ? `AVG(EXTRACT(EPOCH FROM ${sys.expr}))`
        : `MIN(${sys.expr})`;
    // creator.name needs its own alias to avoid colliding with the
    // bucket-field's `u`/`gu` user joins — call it `usort`.
    const joinClause =
      sys.needsCreatorJoin && parsedBucketField?.key !== "creator.name"
        ? `LEFT JOIN "user" usort ON r."createdById" = usort.id`
        : sys.needsCreatorJoin
          ? // Bucket field already aliases the user table; re-point the
            // sort expr at it. Same `u`/`gu` rewrite the bucket-field
            // join did above.
            ""
          : "";
    const exprAdjusted =
      sys.needsCreatorJoin && parsedBucketField?.key === "creator.name"
        ? aggExpr.replace(/usort/g, "u")
        : aggExpr;
    return {
      sortJoin: joinClause,
      sortAggSelect: `, ${exprAdjusted} AS sort_agg`,
      sortOuterSelect: ` sort_agg,`,
      sortOrderExpr: order,
      runMetricsCte: "",
    };
  }

  // config / systemMetadata
  queryParams.push(sortSource);
  const srcIdx = queryParams.length;
  queryParams.push(sortField);
  const keyIdx = queryParams.length;
  const join = `LEFT JOIN "run_field_values" rs ON rs."runId" = r.id AND rs."source" = $${srcIdx} AND rs."key" = $${keyIdx}`;
  // ProjectColumnKey carries a `dataType` per (source, key); the
  // frontend already knows it (it's how column types are presented)
  // and threads it via `sortDataType`. Default to `text` if missing.
  let aggExpr: string;
  switch (input.sortDataType ?? "text") {
    case "number":
      aggExpr = `AVG(rs."numericValue")`;
      break;
    case "date":
      // RunFieldValue stores dates as ISO `textValue`. Safe-cast: if a
      // row's value isn't parseable as a timestamp it just sorts as
      // NULL via NULLS LAST.
      aggExpr = `AVG(EXTRACT(EPOCH FROM rs."textValue"::timestamptz))`;
      break;
    default:
      aggExpr = `MIN(rs."textValue")`;
  }
  return {
    sortJoin: join,
    sortAggSelect: `, ${aggExpr} AS sort_agg`,
    sortOuterSelect: ` sort_agg,`,
    sortOrderExpr: order,
    runMetricsCte: "",
  };
}

// ─── Per-column bucket aggregates (W&B group-row values) ──────────────
//
// Each entry in `input.aggregateColumns` becomes one extra SELECT
// column in the bucket CTE (`agg_0`, `agg_1`, …), plus the joins /
// CTEs needed to evaluate it. Aggregator picker matches sort:
//
//   metric                 → AVG of CH per-run `aggregation` value
//   config/sysmeta number  → AVG(numericValue)
//   config/sysmeta date    → AVG(EXTRACT EPOCH FROM textValue::tstz)
//   system createdAt/...   → AVG(EXTRACT EPOCH FROM r."<col>")
//   anything text / option → null (blank on group rows — W&B parity)
//
// `aggResolved[i] === null` marks unsupported/blank — the SELECT list
// skips that slot; the row-mapping later pushes null so `aggregates`
// stays parallel to the input ordering.

type AggregateColumnInput = {
  source: "system" | "config" | "systemMetadata" | "metric";
  field: string;
  aggregation?: MetricAggregation;
  dataType?: "text" | "number" | "date" | "option";
};

type AggResolved =
  | { kind: "system-date" }
  | { kind: "field-number" }
  | { kind: "field-date" }
  | { kind: "metric" }
  | null;

interface BucketAggFragments {
  /** Concatenated LEFT JOIN clauses (empty when no joins needed). */
  aggJoins: string;
  /** ", AVG(...) AS agg_0, ..." — spliced into the CTE SELECT list. */
  aggSelects: string;
  /** " agg_0, agg_1, …," — appended to the outer SELECT (trailing
   *  comma to compose cleanly with the sort-agg fragment). */
  aggOuterSelects: string;
  /** "run_metrics_agg_0 AS (...), …, " — prepended to WITH clause. */
  aggMetricCtes: string;
  /** Parallel to input. Null slot = column returned nothing (skip). */
  aggResolved: Array<AggResolved>;
}

/** Per-metric CH pre-fetch shared between the main and subgroups
 *  queries — one round trip per `(logName, aggregation)`, keyed by
 *  `"<logName>|<aggregation>"`. */
type PrefetchedAggregateMetrics = Map<string, { runIds: bigint[]; vals: number[] }>;

async function prefetchAggregateMetricValues(
  input: {
    organizationId: string;
    projectName: string;
    aggregateColumns?: AggregateColumnInput[];
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ctx: { clickhouse: any },
): Promise<PrefetchedAggregateMetrics> {
  const out: PrefetchedAggregateMetrics = new Map();
  const cols = (input.aggregateColumns ?? []).slice(0, MAX_AGGREGATE_COLUMNS);
  const wanted = new Map<string, { logName: string; aggregation: MetricAggregation }>();
  for (const c of cols) {
    if (c.source !== "metric") continue;
    const agg = (c.aggregation ?? "LAST") as MetricAggregation;
    const k = `${c.field}|${agg}`;
    if (!wanted.has(k)) wanted.set(k, { logName: c.field, aggregation: agg });
  }
  await Promise.all(
    Array.from(wanted.entries()).map(async ([k, { logName, aggregation }]) => {
      const rows = await queryRunMetricValuesByLogName(ctx.clickhouse, {
        organizationId: input.organizationId,
        projectName: input.projectName,
        logName,
        aggregation,
      });
      out.set(k, {
        runIds: rows.map((r) => BigInt(r.runId)),
        vals: rows.map((r) => Number(r.value)),
      });
    }),
  );
  return out;
}

async function buildBucketColumnAggregateFragments(
  cols: AggregateColumnInput[],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  queryParams: (string | bigint | string[] | number | any)[],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ctx: { prisma: any },
  projectId: bigint,
  prefetchedAggMetricValues: PrefetchedAggregateMetrics,
): Promise<BucketAggFragments> {
  const limited = cols.slice(0, MAX_AGGREGATE_COLUMNS);
  if (limited.length === 0) {
    return { aggJoins: "", aggSelects: "", aggOuterSelects: "", aggMetricCtes: "", aggResolved: [] };
  }

  // Auto-probe dataTypes for config/sysmeta entries that didn't carry
  // one. One indexed lookup for the whole batch — same trick as the
  // sort path.
  const probeKeys: Array<{ source: "config" | "systemMetadata"; key: string }> = [];
  for (const c of limited) {
    if ((c.source === "config" || c.source === "systemMetadata") && !c.dataType) {
      probeKeys.push({ source: c.source, key: c.field });
    }
  }
  let probedDataTypes = new Map<string, "text" | "number" | "date" | "option">();
  if (probeKeys.length > 0) {
    const rows = await ctx.prisma.projectColumnKey.findMany({
      where: {
        projectId,
        OR: probeKeys.map((k: { source: string; key: string }) => ({ source: k.source, key: k.key })),
      },
      select: { source: true, key: true, dataType: true },
    });
    probedDataTypes = new Map((rows as Array<{ source: string; key: string; dataType: string }>).map((r) => [
      `${r.source}:${r.key}`,
      (r.dataType as "text" | "number" | "date" | "option"),
    ]));
  }

  const joins: string[] = [];
  const selects: string[] = [];
  const outers: string[] = [];
  const metricCtes: string[] = [];
  const aggResolved: Array<AggResolved> = [];

  for (let i = 0; i < limited.length; i++) {
    const c = limited[i];
    const colName = `agg_${i}`;

    if (c.source === "metric") {
      const agg = (c.aggregation ?? "LAST") as MetricAggregation;
      const k = `${c.field}|${agg}`;
      const data = prefetchedAggMetricValues.get(k) ?? { runIds: [], vals: [] };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      queryParams.push(data.runIds as any);
      const idsIdx = queryParams.length;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      queryParams.push(data.vals as any);
      const valsIdx = queryParams.length;
      const cteAlias = `run_metrics_agg_${i}`;
      metricCtes.push(`${cteAlias} AS (SELECT * FROM UNNEST($${idsIdx}::bigint[], $${valsIdx}::double precision[]) AS t(run_id, metric_val))`);
      joins.push(`LEFT JOIN ${cteAlias} ${cteAlias}_j ON ${cteAlias}_j.run_id = r.id`);
      selects.push(`AVG(${cteAlias}_j.metric_val) AS ${colName}`);
      outers.push(colName);
      aggResolved.push({ kind: "metric" });
      continue;
    }

    if (c.source === "system") {
      // Only date-like system columns aggregate; status/name/tags stay
      // blank in group rows (W&B parity).
      if (c.field === "createdAt" || c.field === "updatedAt" || c.field === "statusUpdated") {
        selects.push(`AVG(EXTRACT(EPOCH FROM r."${c.field}")) AS ${colName}`);
        outers.push(colName);
        aggResolved.push({ kind: "system-date" });
      } else {
        aggResolved.push(null);
      }
      continue;
    }

    // config / systemMetadata
    const dt = c.dataType
      ?? probedDataTypes.get(`${c.source}:${c.field}`)
      ?? "text";
    if (dt !== "number" && dt !== "date") {
      aggResolved.push(null);
      continue;
    }
    queryParams.push(c.source);
    const srcIdx = queryParams.length;
    queryParams.push(c.field);
    const keyIdx = queryParams.length;
    const alias = `agg_rfv_${i}`;
    joins.push(`LEFT JOIN "run_field_values" ${alias} ON ${alias}."runId" = r.id AND ${alias}."source" = $${srcIdx} AND ${alias}."key" = $${keyIdx}`);
    if (dt === "number") {
      selects.push(`AVG(${alias}."numericValue") AS ${colName}`);
      aggResolved.push({ kind: "field-number" });
    } else {
      selects.push(`AVG(EXTRACT(EPOCH FROM ${alias}."textValue"::timestamptz)) AS ${colName}`);
      aggResolved.push({ kind: "field-date" });
    }
    outers.push(colName);
  }

  return {
    aggJoins: joins.length ? joins.join("\n") : "",
    aggSelects: selects.length ? `, ${selects.join(", ")}` : "",
    // Trailing comma — composes cleanly with the sort-agg outer
    // select fragment in the main SQL template (both are trailing-
    // comma, with a leading space for readability).
    aggOuterSelects: outers.length ? ` ${outers.join(", ")},` : "",
    aggMetricCtes: metricCtes.length ? `${metricCtes.join(", ")}, ` : "",
    aggResolved,
  };
}
