import { z } from "zod";
import { protectedOrgProcedure } from "../../../../lib/trpc";
import { sqidEncode } from "../../../../lib/sqid";
import { searchRunIds, buildRunSearchQuery, type RunSearchParams } from "../../../../lib/run-search";
import {
  queryMetricSortedRunIds,
  queryMetricFilteredRunIds,
  type MetricAggregation,
  type MetricFilterSpec,
} from "../../../../lib/queries/metric-summaries";

const dateFilterSchema = z.object({
  field: z.enum(["createdAt", "updatedAt", "statusUpdated"]),
  operator: z.enum(["before", "after", "between"]),
  value: z.string().datetime(),
  value2: z.string().datetime().optional(),
});

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

/** Allowed system columns for ORDER BY — maps input name to SQL column (prevents injection) */
const SYSTEM_SORT_FIELDS: Record<string, string> = {
  name: '"name"',
  runId: '"id"',
  createdAt: '"createdAt"',
  updatedAt: '"updatedAt"',
  statusUpdated: '"statusUpdated"',
  notes: '"notes"',
};

/** Maximum offset for JSON sort queries to prevent catastrophic deep-pagination.
 *  At 100k rows, OFFSET > 10k + full JSON extract is too slow.
 *  Exported so the REST /api/runs/list custom-sort path clamps the same way. */
export const MAX_JSON_SORT_OFFSET = 100_000;

export type VisibleColumn = { source: "config" | "systemMetadata"; key: string };

/**
 * Enrich run objects with pre-flattened field values from run_field_values.
 * Returns runs with `_flatConfig` and `_flatSystemMetadata` attached.
 *
 * Co-located with runs.list so field values travel with the paginated
 * response — no separate query needed on the client.
 *
 * Exported so the V8-heap CI probe (`/api/runs/list?includeFieldValues=true`)
 * can reuse it and exercise the exact code path the tRPC runs.list uses.
 *
 * `visibleColumns` semantics:
 *   - `undefined`      → fetch ALL (source, key) pairs for the runs (legacy behavior, back-compat)
 *   - `[]`             → skip DB fetch entirely; attach empty blobs
 *   - `[{source,key}]` → only fetch matching pairs; other keys stay absent
 *
 * The `undefined` case is the unbounded-payload path the `visibleColumns`
 * input was introduced to eliminate. New callers should pass a concrete
 * list derived from the user's currently-displayed columns.
 */
export async function attachFieldValues(
  prisma: any,
  runs: { id: bigint; [k: string]: any }[],
  visibleColumns?: VisibleColumn[],
): Promise<typeof runs> {
  if (runs.length === 0) return runs;

  // Empty array: caller explicitly wants no field values. Attach empty
  // blobs so consumers can read `_flatConfig`/`_flatSystemMetadata` without
  // null checks, but skip the DB round-trip entirely.
  if (visibleColumns && visibleColumns.length === 0) {
    return runs.map((run) => ({
      ...run,
      _flatConfig: {} as Record<string, unknown>,
      _flatSystemMetadata: {} as Record<string, unknown>,
    }));
  }

  const rows = await prisma.runFieldValue.findMany({
    where: {
      runId: { in: runs.map((r) => r.id) },
      // When visibleColumns is provided, restrict to the requested
      // (source, key) pairs. Without this filter, we'd still pull every
      // RunFieldValue row per run and filter in JS — the WHERE clause
      // pushes the work to PG and uses the (source, key) index.
      ...(visibleColumns
        ? {
            OR: visibleColumns.map((c) => ({ source: c.source, key: c.key })),
          }
        : {}),
    },
    select: { runId: true, source: true, key: true, textValue: true, numericValue: true },
  });

  // Group by runId
  const byRun = new Map<bigint, { config: Record<string, unknown>; systemMetadata: Record<string, unknown> }>();
  for (const row of rows) {
    let entry = byRun.get(row.runId);
    if (!entry) {
      entry = { config: {}, systemMetadata: {} };
      byRun.set(row.runId, entry);
    }
    const value = row.numericValue ?? row.textValue ?? null;
    if (row.source === "config") {
      entry.config[row.key] = value;
    } else if (row.source === "systemMetadata") {
      entry.systemMetadata[row.key] = value;
    }
  }

  return runs.map((run) => {
    const fv = byRun.get(run.id);
    if (!fv) {
      // When visibleColumns is provided, always attach (possibly empty)
      // blobs for a consistent response shape.
      if (visibleColumns) {
        return { ...run, _flatConfig: {}, _flatSystemMetadata: {} };
      }
      return run;
    }
    return { ...run, _flatConfig: fv.config, _flatSystemMetadata: fv.systemMetadata };
  });
}

export const listRunsProcedure = protectedOrgProcedure
  .input(
    z.object({
      projectName: z.string(),
      search: z.string().optional(),
      tags: z.array(z.string()).optional(),
      status: z.array(z.enum(["RUNNING", "COMPLETED", "FAILED", "TERMINATED", "CANCELLED"])).optional(),
      dateFilters: z.array(dateFilterSchema).optional(),
      fieldFilters: z.array(fieldFilterSchema).optional(),
      limit: z.number().min(1).max(200).default(10),
      cursor: z.number().optional(),
      direction: z.enum(["forward", "backward"]).default("forward"),
      // Server-side sorting
      sortField: z.string().optional(),
      sortSource: z.enum(["system", "config", "systemMetadata", "metric"]).optional(),
      sortDirection: z.enum(["asc", "desc"]).optional(),
      offset: z.number().min(0).optional(),
      // Keyset cursor for sorted queries (opaque string: "sortValue::id")
      sortCursor: z.string().optional(),
      // Metric-specific sort params (when sortSource === "metric")
      sortAggregation: z.enum(["MIN", "MAX", "AVG", "LAST", "VARIANCE"]).optional(),
      // Metric filters (applied via ClickHouse HAVING clauses)
      metricFilters: z.array(metricFilterSchema).optional(),
      // System filters (name, status, tags, creator.name — full operator semantics)
      systemFilters: z.array(systemFilterSchema).optional(),
      // Restrict `_flatConfig`/`_flatSystemMetadata` to the columns the
      // client is actually displaying. Omit → legacy behavior (all keys,
      // unbounded payload). Empty array → no field values at all.
      visibleColumns: z
        .array(z.object({ source: z.enum(["config", "systemMetadata"]), key: z.string() }))
        .optional(),
    })
  )
  .query(async ({ ctx, input }) => {
    const hasCustomSort = input.sortField && input.sortSource && input.sortDirection;

    // ─── Default sort (no custom sort) ───────────────────────────────
    // Uses cursor-based pagination on createdAt DESC — unchanged from original.
    if (!hasCustomSort) {
      return defaultCursorQuery(ctx, input);
    }

    // ─── Metric sort (ClickHouse aggregation sort) ───────────────────
    // Two-phase cross-database query: PG filters → CH sort → PG full records.
    if (input.sortSource === "metric") {
      return metricSortQuery(ctx, input);
    }

    // ─── System column sort (name, createdAt, etc.) ──────────────────
    // Uses keyset pagination: O(1) at any page depth with covering indexes.
    if (input.sortSource === "system") {
      return systemColumnSortQuery(ctx, input);
    }

    // ─── JSON field sort (config / systemMetadata) ───────────────────
    // Uses run_field_values table for index-backed sorting.
    return jsonFieldSortQuery(ctx, input);
  });

// ═══════════════════════════════════════════════════════════════════════
// Default cursor-based query (no custom sort)
// ═══════════════════════════════════════════════════════════════════════
async function defaultCursorQuery(
  ctx: any,
  input: {
    organizationId: string;
    projectName: string;
    search?: string;
    tags?: string[];
    status?: string[];
    dateFilters?: z.infer<typeof dateFilterSchema>[];
    fieldFilters?: z.infer<typeof fieldFilterSchema>[];
    metricFilters?: z.infer<typeof metricFilterSchema>[];
    systemFilters?: z.infer<typeof systemFilterSchema>[];
    visibleColumns?: VisibleColumn[];
    limit: number;
    cursor?: number;
    offset?: number;
    direction: "forward" | "backward";
  },
) {
  // If there are field filters, metric filters, or system filters, use raw SQL to handle them
  if (input.fieldFilters?.length || input.metricFilters?.length || input.systemFilters?.length) {
    return defaultCursorQueryWithFieldFilters(ctx, input);
  }

  let searchMatchIds: bigint[] | undefined;

  if (input.search && input.search.trim()) {
    const project = await ctx.prisma.projects.findFirst({
      where: { name: input.projectName, organizationId: input.organizationId },
      select: { id: true },
    });
    if (!project) return { runs: [], nextCursor: null, nextOffset: null };

    const matchIds = await searchRunIds(ctx.prisma, {
      organizationId: input.organizationId,
      projectId: project.id,
      search: input.search.trim(),
      tags: input.tags,
      status: input.status,
      dateFilters: input.dateFilters,
    });
    if (matchIds.length === 0) return { runs: [], nextCursor: null, nextOffset: null };
    searchMatchIds = matchIds;
  }

  const dateWhere = buildPrismaDateWhere(input.dateFilters, !!searchMatchIds);

  // When offset is provided (and no cursor), use a two-step cursor lookup
  // instead of raw OFFSET — OFFSET is O(N) because PG scans and discards rows,
  // while a lightweight cursor lookup + seek is nearly O(1) at any depth.
  const useOffset = input.offset != null && input.offset > 0 && !input.cursor;

  const whereClause = {
    project: { name: input.projectName },
    organizationId: input.organizationId,
    ...(searchMatchIds ? { id: { in: searchMatchIds } } : {}),
    ...(!searchMatchIds && input.tags?.length ? { tags: { hasSome: input.tags } } : {}),
    ...(!searchMatchIds && input.status?.length ? { status: { in: input.status } } : {}),
    ...dateWhere,
  };
  const orderBy = { createdAt: input.direction === "forward" ? "desc" as const : "asc" as const };
  const selectClause = {
    id: true, name: true, number: true, status: true, statusUpdated: true,
    createdAt: true, updatedAt: true, tags: true, notes: true, externalId: true,
    forkedFromRunId: true, forkStep: true,
    creator: { select: { name: true, email: true } },
    project: { select: { runPrefix: true } },
  };

  if (useOffset) {
    // Step 1: Lightweight cursor lookup — only fetches id, uses index scan
    const cursorRow = await ctx.prisma.runs.findFirst({
      where: whereClause,
      orderBy,
      select: { id: true },
      skip: input.offset!,
    });

    if (!cursorRow) {
      return { runs: [], nextCursor: null, nextOffset: null };
    }

    // Step 2: Fetch full records from cursor position (O(1) seek)
    const runs = await ctx.prisma.runs.findMany({
      where: whereClause,
      orderBy,
      select: selectClause,
      take: input.limit,
      cursor: { id: cursorRow.id },
    });

    const enriched = await attachFieldValues(ctx.prisma, runs, input.visibleColumns);
    const nextOffset = runs.length === input.limit ? input.offset! + runs.length : null;
    return {
      runs: enriched.map((r: any) => ({ ...r, id: sqidEncode(r.id), forkedFromRunId: r.forkedFromRunId ? sqidEncode(r.forkedFromRunId) : null })),
      nextCursor: null,
      nextOffset,
    };
  }

  const runs = await ctx.prisma.runs.findMany({
    where: whereClause,
    orderBy,
    select: selectClause,
    take: input.limit,
    skip: input.cursor ? 1 : 0,
    cursor: input.cursor ? { id: input.cursor } : undefined,
  });

  const enriched = await attachFieldValues(ctx.prisma, runs, input.visibleColumns);
  const nextCursor = runs.length === input.limit ? runs[runs.length - 1].id : null;
  return {
    runs: enriched.map((r: any) => ({ ...r, id: sqidEncode(r.id), forkedFromRunId: r.forkedFromRunId ? sqidEncode(r.forkedFromRunId) : null })),
    nextCursor,
    nextOffset: null,
  };
}

/**
 * Default cursor query with field filter support — falls back to raw SQL
 * to inject EXISTS subqueries for run_field_values filtering.
 */
async function defaultCursorQueryWithFieldFilters(
  ctx: any,
  input: {
    organizationId: string;
    projectName: string;
    search?: string;
    tags?: string[];
    status?: string[];
    dateFilters?: z.infer<typeof dateFilterSchema>[];
    fieldFilters?: z.infer<typeof fieldFilterSchema>[];
    metricFilters?: z.infer<typeof metricFilterSchema>[];
    systemFilters?: z.infer<typeof systemFilterSchema>[];
    visibleColumns?: VisibleColumn[];
    limit: number;
    cursor?: number;
    offset?: number;
    direction: "forward" | "backward";
  },
) {
  const conditions: string[] = [`r."organizationId" = $1`];
  const queryParams: (string | bigint | string[] | number)[] = [input.organizationId];

  queryParams.push(input.projectName);
  conditions.push(`p.name = $${queryParams.length}`);

  // Search
  if (input.search && input.search.trim()) {
    const project = await ctx.prisma.projects.findFirst({
      where: { name: input.projectName, organizationId: input.organizationId },
      select: { id: true },
    });
    if (!project) return { runs: [], nextCursor: null, nextOffset: null };

    const matchIds = await searchRunIds(ctx.prisma, {
      organizationId: input.organizationId,
      projectId: project.id,
      search: input.search.trim(),
      tags: input.tags,
      status: input.status,
      dateFilters: input.dateFilters,
      systemFilters: input.systemFilters,
    });
    if (matchIds.length === 0) return { runs: [], nextCursor: null, nextOffset: null };

    queryParams.push(matchIds as any);
    conditions.push(`r.id = ANY($${queryParams.length}::bigint[])`);
  } else {
    if (input.tags?.length) {
      queryParams.push(input.tags);
      conditions.push(`r.tags && $${queryParams.length}::text[]`);
    }
    if (input.status?.length) {
      queryParams.push(input.status);
      conditions.push(`r.status = ANY($${queryParams.length}::"RunStatus"[])`);
    }
    appendDateFiltersRaw(conditions, queryParams, input.dateFilters);
  }

  // Field filters
  buildFieldFilterConditions(conditions, queryParams, input.fieldFilters);

  // System filters (name, status, tags, creator.name) — only when not searching
  // (when searching, system filters are already applied inside searchRunIds)
  let needsCreatorJoin = false;
  if (!input.search?.trim()) {
    const result = buildSystemFilterConditions(conditions, queryParams, input.systemFilters);
    needsCreatorJoin = result.needsCreatorJoin;
  }

  // Metric filters — pre-filter via ClickHouse, then inject matching run IDs
  if (input.metricFilters?.length) {
    const mfRunIds = await queryMetricFilteredRunIds(ctx.clickhouse, {
      organizationId: input.organizationId,
      projectName: input.projectName,
      metricFilters: input.metricFilters.map((mf) => ({
        logName: mf.logName,
        aggregation: mf.aggregation as MetricAggregation,
        operator: mf.operator,
        values: mf.values,
      })),
    });
    if (mfRunIds.length === 0) return { runs: [], nextCursor: null, nextOffset: null };
    queryParams.push(mfRunIds.map((id) => BigInt(id)) as any);
    conditions.push(`r.id = ANY($${queryParams.length}::bigint[])`);
  }

  // When offset is provided (and no cursor), use a two-step cursor lookup
  // instead of raw OFFSET to avoid O(N) row scanning at high offsets.
  const useOffset = input.offset != null && input.offset > 0 && !input.cursor;

  const dir = input.direction === "forward" ? "DESC" : "ASC";
  const creatorJoin = needsCreatorJoin ? `LEFT JOIN "user" u ON r."createdById" = u.id` : "";

  // Cursor / offset pagination uses a COMPOUND (createdAt, id) keyset
  // rather than `r.id < cursor` alone.
  //
  // Background: ORDER BY createdAt DESC paginated by `r.id < cursor`
  // assumes id and createdAt are monotonically aligned (newer createdAt =>
  // larger id). That holds for normal sequential inserts, but breaks for
  // any data set where timestamps are backfilled out-of-order — e.g.
  // seed-demo.ts:852-857 deliberately reverses them, and any imported /
  // migrated runs can do the same. With non-aligned data, `r.id < cursor`
  // selects rows that come BEFORE the cursor in createdAt-DESC order, so
  // page 2 returns the same rows as page 1 minus one, producing visible
  // duplicates and pinning the user to the first batch.
  //
  // Fix: compound keyset on (createdAt, id) which exactly matches the
  // ORDER BY tuple. id is the tiebreaker for runs sharing a createdAt,
  // so pagination is also stable across duplicate timestamps.
  if (useOffset) {
    // Step 1: lookup the row at OFFSET — also fetch its createdAt so we
    // can build a compound keyset for step 2.
    const cursorQuery = `
      SELECT r.id, r."createdAt"
      FROM "runs" r
      JOIN "projects" p ON r."projectId" = p.id
      ${creatorJoin}
      WHERE ${conditions.join(" AND ")}
      ORDER BY r."createdAt" ${dir}, r.id ${dir}
      OFFSET ${input.offset} LIMIT 1
    `;
    const cursorRows: { id: bigint; createdAt: Date }[] = await ctx.prisma.$queryRawUnsafe(cursorQuery, ...queryParams);
    if (cursorRows.length === 0) return { runs: [], nextCursor: null, nextOffset: null };

    // Step 2: inclusive seek (cursor row is the first row of the new page).
    const cursorRow = cursorRows[0];
    queryParams.push(cursorRow.createdAt.toISOString());
    const createdAtIdx = queryParams.length;
    queryParams.push(cursorRow.id as any);
    const idIdx = queryParams.length;
    const cmp = input.direction === "forward" ? "<=" : ">=";
    conditions.push(
      `(r."createdAt", r.id) ${cmp} ($${createdAtIdx}::timestamptz, $${idIdx}::bigint)`,
    );
  } else if (input.cursor) {
    // Normal cursor pagination — exclusive seek (cursor was the last row
    // of the previous page; fetch rows after it). Look up the cursor
    // row's createdAt so we can build the compound keyset.
    const cursorRow = await ctx.prisma.runs.findUnique({
      where: { id: BigInt(input.cursor) },
      select: { createdAt: true },
    });
    if (!cursorRow) return { runs: [], nextCursor: null, nextOffset: null };
    queryParams.push(cursorRow.createdAt.toISOString());
    const createdAtIdx = queryParams.length;
    queryParams.push(BigInt(input.cursor) as any);
    const idIdx = queryParams.length;
    const cmp = input.direction === "forward" ? "<" : ">";
    conditions.push(
      `(r."createdAt", r.id) ${cmp} ($${createdAtIdx}::timestamptz, $${idIdx}::bigint)`,
    );
  }

  const query = `
    SELECT r.id
    FROM "runs" r
    JOIN "projects" p ON r."projectId" = p.id
    ${creatorJoin}
    WHERE ${conditions.join(" AND ")}
    ORDER BY r."createdAt" ${dir}, r.id ${dir}
    LIMIT ${input.limit}
  `;

  const rows: { id: bigint }[] = await ctx.prisma.$queryRawUnsafe(query, ...queryParams);
  if (rows.length === 0) return { runs: [], nextCursor: null, nextOffset: null };

  const runs = await ctx.prisma.runs.findMany({
    where: { id: { in: rows.map((r) => r.id) } },
    select: {
      id: true, name: true, number: true, status: true, statusUpdated: true,
      createdAt: true, updatedAt: true, tags: true, notes: true, externalId: true,
      forkedFromRunId: true, forkStep: true,
      creator: { select: { name: true, email: true } },
      project: { select: { runPrefix: true } },
    },
  });

  const idOrder = new Map(rows.map((r, i) => [r.id, i]));
  runs.sort((a: any, b: any) => (idOrder.get(a.id) ?? 0) - (idOrder.get(b.id) ?? 0));

  const enriched = await attachFieldValues(ctx.prisma, runs, input.visibleColumns);

  if (useOffset) {
    const nextOffset = runs.length === input.limit ? input.offset! + runs.length : null;
    return {
      runs: enriched.map((r: any) => ({ ...r, id: sqidEncode(r.id), forkedFromRunId: r.forkedFromRunId ? sqidEncode(r.forkedFromRunId) : null })),
      nextCursor: null,
      nextOffset,
    };
  }

  const nextCursor = runs.length === input.limit ? runs[runs.length - 1].id : null;
  return {
    runs: enriched.map((r: any) => ({ ...r, id: sqidEncode(r.id), forkedFromRunId: r.forkedFromRunId ? sqidEncode(r.forkedFromRunId) : null })),
    nextCursor,
    nextOffset: null,
  };
}

// ═══════════════════════════════════════════════════════════════════════
// System column sort with keyset pagination
// ═══════════════════════════════════════════════════════════════════════
async function systemColumnSortQuery(
  ctx: any,
  input: {
    organizationId: string;
    projectName: string;
    search?: string;
    tags?: string[];
    status?: string[];
    dateFilters?: z.infer<typeof dateFilterSchema>[];
    fieldFilters?: z.infer<typeof fieldFilterSchema>[];
    metricFilters?: z.infer<typeof metricFilterSchema>[];
    systemFilters?: z.infer<typeof systemFilterSchema>[];
    visibleColumns?: VisibleColumn[];
    limit: number;
    offset?: number;
    sortField?: string;
    sortDirection?: "asc" | "desc";
    sortCursor?: string;
  },
) {
  const field = SYSTEM_SORT_FIELDS[input.sortField!] ? input.sortField! : "createdAt";
  const sqlCol = SYSTEM_SORT_FIELDS[field];
  const dir = input.sortDirection === "asc" ? "ASC" : "DESC";
  const gtLt = input.sortDirection === "asc" ? ">" : "<";

  // Build WHERE conditions
  const conditions: string[] = [`r."organizationId" = $1`];
  const queryParams: (string | bigint | string[] | number)[] = [input.organizationId];

  queryParams.push(input.projectName);
  conditions.push(`p.name = $${queryParams.length}`);

  // Search: inline as subquery or materialize (search sets are typically small for system sort)
  if (input.search && input.search.trim()) {
    const project = await ctx.prisma.projects.findFirst({
      where: { name: input.projectName, organizationId: input.organizationId },
      select: { id: true },
    });
    if (!project) return { runs: [], nextCursor: null, nextOffset: null, sortCursor: null };

    const matchIds = await searchRunIds(ctx.prisma, {
      organizationId: input.organizationId,
      projectId: project.id,
      search: input.search.trim(),
      tags: input.tags,
      status: input.status,
      dateFilters: input.dateFilters,
      systemFilters: input.systemFilters,
    });
    if (matchIds.length === 0) return { runs: [], nextCursor: null, nextOffset: null, sortCursor: null };

    queryParams.push(matchIds as any);
    conditions.push(`r.id = ANY($${queryParams.length}::bigint[])`);
  } else {
    // Apply filters directly
    if (input.tags?.length) {
      queryParams.push(input.tags);
      conditions.push(`r.tags && $${queryParams.length}::text[]`);
    }
    if (input.status?.length) {
      queryParams.push(input.status);
      conditions.push(`r.status = ANY($${queryParams.length}::"RunStatus"[])`);
    }
    appendDateFiltersRaw(conditions, queryParams, input.dateFilters);
  }

  // Field filters
  buildFieldFilterConditions(conditions, queryParams, input.fieldFilters);

  // System filters (name, status, tags, creator.name) — only when not searching
  let sysNeedsCreator = false;
  if (!input.search?.trim()) {
    const result = buildSystemFilterConditions(conditions, queryParams, input.systemFilters);
    sysNeedsCreator = result.needsCreatorJoin;
  }

  // Metric filters — pre-filter via ClickHouse
  if (input.metricFilters?.length) {
    const mfRunIds = await queryMetricFilteredRunIds(ctx.clickhouse, {
      organizationId: input.organizationId,
      projectName: input.projectName,
      metricFilters: input.metricFilters.map((mf) => ({
        logName: mf.logName,
        aggregation: mf.aggregation as MetricAggregation,
        operator: mf.operator,
        values: mf.values,
      })),
    });
    if (mfRunIds.length === 0) return { runs: [], nextCursor: null, nextOffset: null, sortCursor: null };
    queryParams.push(mfRunIds.map((id) => BigInt(id)) as any);
    conditions.push(`r.id = ANY($${queryParams.length}::bigint[])`);
  }

  // When offset is provided (and no sortCursor), use a two-step cursor lookup
  // instead of raw OFFSET to avoid O(N) row scanning at high offsets.
  const useOffset = input.offset != null && input.offset > 0 && !input.sortCursor;

  const sysCreatorJoin = sysNeedsCreator ? `LEFT JOIN "user" u ON r."createdById" = u.id` : "";

  if (useOffset) {
    // Step 1: Lightweight cursor lookup — find the sort value + id at target offset
    const cursorQuery = `
      SELECT r.id, r.${sqlCol} as sort_val
      FROM "runs" r
      JOIN "projects" p ON r."projectId" = p.id
      ${sysCreatorJoin}
      WHERE ${conditions.join(" AND ")}
      ORDER BY r.${sqlCol} ${dir} NULLS LAST, r.id ${dir}
      OFFSET ${input.offset} LIMIT 1
    `;
    const cursorRows: { id: bigint; sort_val: any }[] = await ctx.prisma.$queryRawUnsafe(cursorQuery, ...queryParams);
    if (cursorRows.length === 0) return { runs: [], nextCursor: null, nextOffset: null, sortCursor: null };

    // Step 2: Fetch from cursor position using keyset condition
    const cursorVal = cursorRows[0].sort_val;
    const cursorId = cursorRows[0].id;
    queryParams.push(cursorVal instanceof Date ? cursorVal.toISOString() : String(cursorVal));
    const valIdx = queryParams.length;
    queryParams.push(cursorId as any);
    const idIdx = queryParams.length;
    // Use >= / <= (inclusive) since the cursor row itself is the first result
    const geLe = input.sortDirection === "asc" ? ">=" : "<=";
    conditions.push(`(r.${sqlCol}, r.id) ${geLe} ($${valIdx}::${getSqlCastType(field)}, $${idIdx}::bigint)`);
  } else if (input.sortCursor) {
    // Keyset pagination: WHERE (sortCol, id) > ($cursorVal, $cursorId)
    const parts = input.sortCursor.split("::");
    if (parts.length === 2) {
      const cursorVal = parts[0];
      const cursorId = parts[1];
      queryParams.push(cursorVal);
      const valIdx = queryParams.length;
      queryParams.push(BigInt(cursorId) as any);
      const idIdx = queryParams.length;
      conditions.push(`(r.${sqlCol}, r.id) ${gtLt} ($${valIdx}::${getSqlCastType(field)}, $${idIdx}::bigint)`);
    }
  }

  const query = `
    SELECT r.id, r.${sqlCol} as sort_val
    FROM "runs" r
    JOIN "projects" p ON r."projectId" = p.id
    ${sysCreatorJoin}
    WHERE ${conditions.join(" AND ")}
    ORDER BY r.${sqlCol} ${dir} NULLS LAST, r.id ${dir}
    LIMIT ${input.limit}
  `;

  const rows: { id: bigint; sort_val: any }[] = await ctx.prisma.$queryRawUnsafe(query, ...queryParams);

  if (rows.length === 0) {
    return { runs: [], nextCursor: null, nextOffset: null, sortCursor: null };
  }

  // Fetch full records
  const runs = await ctx.prisma.runs.findMany({
    where: { id: { in: rows.map((r) => r.id) } },
    select: {
      id: true, name: true, number: true, status: true, statusUpdated: true,
      createdAt: true, updatedAt: true, tags: true, notes: true, externalId: true,
      forkedFromRunId: true, forkStep: true,
      creator: { select: { name: true, email: true } },
      project: { select: { runPrefix: true } },
    },
  });

  // Re-sort to match SQL order
  const idOrder = new Map(rows.map((r, i) => [r.id, i]));
  runs.sort((a: any, b: any) => (idOrder.get(a.id) ?? 0) - (idOrder.get(b.id) ?? 0));

  const enriched = await attachFieldValues(ctx.prisma, runs, input.visibleColumns);

  if (useOffset) {
    const nextOffset = runs.length === input.limit ? input.offset! + runs.length : null;
    return {
      runs: enriched.map((r: any) => ({ ...r, id: sqidEncode(r.id), forkedFromRunId: r.forkedFromRunId ? sqidEncode(r.forkedFromRunId) : null })),
      nextCursor: null,
      nextOffset,
      sortCursor: null,
    };
  }

  // Build next keyset cursor from last row
  const lastRow = rows[rows.length - 1];
  const nextSortCursor = rows.length === input.limit
    ? `${lastRow.sort_val instanceof Date ? lastRow.sort_val.toISOString() : String(lastRow.sort_val)}::${lastRow.id}`
    : null;

  return {
    runs: enriched.map((r: any) => ({ ...r, id: sqidEncode(r.id), forkedFromRunId: r.forkedFromRunId ? sqidEncode(r.forkedFromRunId) : null })),
    nextCursor: null,
    nextOffset: null,
    sortCursor: nextSortCursor,
  };
}

// ═══════════════════════════════════════════════════════════════════════
// JSON field sort using run_field_values table
// ═══════════════════════════════════════════════════════════════════════
async function jsonFieldSortQuery(
  ctx: any,
  input: {
    organizationId: string;
    projectName: string;
    search?: string;
    tags?: string[];
    status?: string[];
    dateFilters?: z.infer<typeof dateFilterSchema>[];
    fieldFilters?: z.infer<typeof fieldFilterSchema>[];
    metricFilters?: z.infer<typeof metricFilterSchema>[];
    systemFilters?: z.infer<typeof systemFilterSchema>[];
    visibleColumns?: VisibleColumn[];
    limit: number;
    sortField?: string;
    sortSource?: "system" | "config" | "systemMetadata" | "metric";
    sortDirection?: "asc" | "desc";
    offset?: number;
  },
) {
  const offset = Math.min(input.offset ?? 0, MAX_JSON_SORT_OFFSET);
  const sortSource = input.sortSource === "config" ? "config" : "systemMetadata";
  const sortKey = input.sortField!;

  const project = await ctx.prisma.projects.findFirst({
    where: { name: input.projectName, organizationId: input.organizationId },
    select: { id: true },
  });
  if (!project) return { runs: [], nextCursor: null, nextOffset: null };

  // Build WHERE conditions for the main query
  const conditions: string[] = [`r."organizationId" = $1`];
  const queryParams: (string | bigint | string[] | number)[] = [input.organizationId];

  queryParams.push(input.projectName);
  conditions.push(`p.name = $${queryParams.length}`);

  // If search is active, inline it as a subquery instead of materializing IDs
  let searchCTE = "";
  if (input.search && input.search.trim()) {
    const searchParams: RunSearchParams = {
      organizationId: input.organizationId,
      projectId: project.id,
      search: input.search.trim(),
      tags: input.tags,
      status: input.status,
      dateFilters: input.dateFilters,
      systemFilters: input.systemFilters,
    };
    const { query: searchQuery, params: searchQueryParams } = buildRunSearchQuery(searchParams);

    // Re-number parameters
    const paramOffset = queryParams.length;
    const renumberedSearchQuery = searchQuery.replace(
      /\$(\d+)/g,
      (_, num) => `$${Number(num) + paramOffset}`,
    );
    queryParams.push(...searchQueryParams);

    searchCTE = `search_matches AS (${renumberedSearchQuery}),`;
    conditions.push(`r.id IN (SELECT id FROM search_matches)`);
  } else {
    // Apply filters directly
    if (input.tags?.length) {
      queryParams.push(input.tags);
      conditions.push(`r.tags && $${queryParams.length}::text[]`);
    }
    if (input.status?.length) {
      queryParams.push(input.status);
      conditions.push(`r.status = ANY($${queryParams.length}::"RunStatus"[])`);
    }
    appendDateFiltersRaw(conditions, queryParams, input.dateFilters);
  }

  // Field filters
  buildFieldFilterConditions(conditions, queryParams, input.fieldFilters);

  // System filters (name, status, tags, creator.name) — only when not searching
  let jsonNeedsCreator = false;
  if (!input.search?.trim()) {
    const result = buildSystemFilterConditions(conditions, queryParams, input.systemFilters);
    jsonNeedsCreator = result.needsCreatorJoin;
  }

  // Metric filters — pre-filter via ClickHouse
  if (input.metricFilters?.length) {
    const mfRunIds = await queryMetricFilteredRunIds(ctx.clickhouse, {
      organizationId: input.organizationId,
      projectName: input.projectName,
      metricFilters: input.metricFilters.map((mf) => ({
        logName: mf.logName,
        aggregation: mf.aggregation as MetricAggregation,
        operator: mf.operator,
        values: mf.values,
      })),
    });
    if (mfRunIds.length === 0) return { runs: [], nextCursor: null, nextOffset: null };
    queryParams.push(mfRunIds.map((id) => BigInt(id)) as any);
    conditions.push(`r.id = ANY($${queryParams.length}::bigint[])`);
  }

  const jsonCreatorJoin = jsonNeedsCreator ? `LEFT JOIN "user" u ON r."createdById" = u.id` : "";

  // Delegate the run_field_values ORDER BY to the shared helper so tRPC and the
  // REST /api/runs/list `sort=config.*` path run ONE implementation. We hand it
  // our fully-assembled filter fragment (search CTE + conditions + params +
  // creator join); the helper appends the LEFT JOIN sort column and ORDER BY.
  const sortedRunIds = await queryFieldSortedRunIds(ctx.prisma, {
    organizationId: input.organizationId,
    source: sortSource,
    key: sortKey,
    direction: input.sortDirection === "asc" ? "asc" : "desc",
    limit: input.limit,
    offset,
    prefilter: {
      conditions,
      params: queryParams,
      searchCTE,
      creatorJoin: jsonCreatorJoin,
    },
  });
  const sortedIds: { id: bigint }[] = sortedRunIds.map((id) => ({ id }));

  if (sortedIds.length === 0) {
    return { runs: [], nextCursor: null, nextOffset: null };
  }

  // Fetch full records
  const runs = await ctx.prisma.runs.findMany({
    where: { id: { in: sortedIds.map((r) => r.id) } },
    select: {
      id: true, name: true, number: true, status: true, statusUpdated: true,
      createdAt: true, updatedAt: true, tags: true, notes: true, externalId: true,
      forkedFromRunId: true, forkStep: true,
      creator: { select: { name: true, email: true } },
      project: { select: { runPrefix: true } },
    },
  });

  // Re-sort to match SQL order
  const idOrder = new Map(sortedIds.map((r, i) => [r.id, i]));
  runs.sort((a: any, b: any) => (idOrder.get(a.id) ?? 0) - (idOrder.get(b.id) ?? 0));

  const nextOffset = sortedIds.length === input.limit && offset + sortedIds.length <= MAX_JSON_SORT_OFFSET
    ? offset + sortedIds.length
    : null;

  const enriched = await attachFieldValues(ctx.prisma, runs, input.visibleColumns);
  return {
    runs: enriched.map((r: any) => ({ ...r, id: sqidEncode(r.id), forkedFromRunId: r.forkedFromRunId ? sqidEncode(r.forkedFromRunId) : null })),
    nextCursor: null,
    nextOffset,
  };
}

// ═══════════════════════════════════════════════════════════════════════
// Metric sort query (ClickHouse-driven sort with PG hydration)
// ═══════════════════════════════════════════════════════════════════════
async function metricSortQuery(
  ctx: any,
  input: {
    organizationId: string;
    projectName: string;
    search?: string;
    tags?: string[];
    status?: string[];
    dateFilters?: z.infer<typeof dateFilterSchema>[];
    fieldFilters?: z.infer<typeof fieldFilterSchema>[];
    metricFilters?: z.infer<typeof metricFilterSchema>[];
    systemFilters?: z.infer<typeof systemFilterSchema>[];
    visibleColumns?: VisibleColumn[];
    limit: number;
    sortField?: string;
    sortAggregation?: string;
    sortDirection?: "asc" | "desc";
    offset?: number;
  },
) {
  const t0 = performance.now();
  const offset = Math.min(input.offset ?? 0, MAX_JSON_SORT_OFFSET);
  const sortLogName = input.sortField!;
  const sortAggregation = (input.sortAggregation ?? "LAST") as MetricAggregation;
  const sortDirection = input.sortDirection === "asc" ? "ASC" as const : "DESC" as const;

  // Phase 1: Get candidate run IDs from PostgreSQL (all filters except metric)
  const candidateRunIds = await getCandidateRunIds(ctx, input);
  const t1 = performance.now();

  // Phase 2: Query ClickHouse for sorted run IDs
  const metricFilters: MetricFilterSpec[] | undefined = input.metricFilters?.map((mf) => ({
    logName: mf.logName,
    aggregation: mf.aggregation as MetricAggregation,
    operator: mf.operator,
    values: mf.values,
  }));

  const sortedRows = await queryMetricSortedRunIds(ctx.clickhouse, {
    organizationId: input.organizationId,
    projectName: input.projectName,
    sortLogName,
    sortAggregation,
    sortDirection,
    limit: input.limit,
    offset,
    candidateRunIds: candidateRunIds ?? undefined,
    metricFilters,
  });
  const t2 = performance.now();

  if (sortedRows.length === 0) {
    console.log(`[metricSortQuery] ${input.projectName} empty — PG candidates: ${(t1-t0).toFixed(0)}ms, CH sort: ${(t2-t1).toFixed(0)}ms`);
    return { runs: [], nextCursor: null, nextOffset: null };
  }

  // Phase 3: Fetch full records from PostgreSQL
  const sortedRunIds = sortedRows.map((r) => BigInt(r.runId));
  const runs = await ctx.prisma.runs.findMany({
    where: { id: { in: sortedRunIds } },
    select: {
      id: true, name: true, number: true, status: true, statusUpdated: true,
      createdAt: true, updatedAt: true, tags: true, notes: true, externalId: true,
      forkedFromRunId: true, forkStep: true,
      creator: { select: { name: true, email: true } },
      project: { select: { runPrefix: true } },
    },
  });
  const t3 = performance.now();

  // Re-sort to match ClickHouse order
  const idOrder = new Map(sortedRows.map((r, i) => [BigInt(r.runId), i]));
  runs.sort((a: any, b: any) => (idOrder.get(a.id) ?? 0) - (idOrder.get(b.id) ?? 0));

  const nextOffset = sortedRows.length === input.limit && offset + sortedRows.length <= MAX_JSON_SORT_OFFSET
    ? offset + sortedRows.length
    : null;

  const enriched = await attachFieldValues(ctx.prisma, runs, input.visibleColumns);
  const t4 = performance.now();

  console.log(`[metricSortQuery] ${input.projectName} sort=${sortLogName} — PG candidates: ${(t1-t0).toFixed(0)}ms, CH sort: ${(t2-t1).toFixed(0)}ms, PG hydrate: ${(t3-t2).toFixed(0)}ms, fieldValues: ${(t4-t3).toFixed(0)}ms, total: ${(t4-t0).toFixed(0)}ms (${sortedRows.length} sorted, ${runs.length} hydrated)`);

  return {
    runs: enriched.map((r: any) => ({ ...r, id: sqidEncode(r.id), forkedFromRunId: r.forkedFromRunId ? sqidEncode(r.forkedFromRunId) : null })),
    nextCursor: null,
    nextOffset,
  };
}

/**
 * Get candidate run IDs from PostgreSQL using all non-metric filters.
 * Returns null if no PG filtering is needed (all runs in the project are candidates).
 * Returns an array of numeric run IDs when PG filters are active.
 */
async function getCandidateRunIds(
  ctx: any,
  input: {
    organizationId: string;
    projectName: string;
    search?: string;
    tags?: string[];
    status?: string[];
    dateFilters?: z.infer<typeof dateFilterSchema>[];
    fieldFilters?: z.infer<typeof fieldFilterSchema>[];
    systemFilters?: z.infer<typeof systemFilterSchema>[];
  },
): Promise<number[] | null> {
  const hasSearch = input.search && input.search.trim();
  const hasTags = input.tags && input.tags.length > 0;
  const hasStatus = input.status && input.status.length > 0;
  const hasDateFilters = input.dateFilters && input.dateFilters.length > 0;
  const hasFieldFilters = input.fieldFilters && input.fieldFilters.length > 0;
  const hasSystemFilters = input.systemFilters && input.systemFilters.length > 0;

  // No PG filters — all runs in the project are candidates
  if (!hasSearch && !hasTags && !hasStatus && !hasDateFilters && !hasFieldFilters && !hasSystemFilters) {
    return null;
  }

  const conditions: string[] = [`r."organizationId" = $1`];
  const queryParams: (string | bigint | string[] | number)[] = [input.organizationId];

  queryParams.push(input.projectName);
  conditions.push(`p.name = $${queryParams.length}`);

  if (hasSearch) {
    const project = await ctx.prisma.projects.findFirst({
      where: { name: input.projectName, organizationId: input.organizationId },
      select: { id: true },
    });
    if (!project) return [];

    const matchIds = await searchRunIds(ctx.prisma, {
      organizationId: input.organizationId,
      projectId: project.id,
      search: input.search!.trim(),
      tags: input.tags,
      status: input.status,
      dateFilters: input.dateFilters,
      systemFilters: input.systemFilters,
    });
    if (matchIds.length === 0) return [];

    queryParams.push(matchIds as any);
    conditions.push(`r.id = ANY($${queryParams.length}::bigint[])`);
  } else {
    if (hasTags) {
      queryParams.push(input.tags!);
      conditions.push(`r.tags && $${queryParams.length}::text[]`);
    }
    if (hasStatus) {
      queryParams.push(input.status!);
      conditions.push(`r.status = ANY($${queryParams.length}::"RunStatus"[])`);
    }
    appendDateFiltersRaw(conditions, queryParams, input.dateFilters);
  }

  if (hasFieldFilters) {
    buildFieldFilterConditions(conditions, queryParams, input.fieldFilters);
  }

  // System filters (name, status, tags, creator.name) — only when not searching
  let candNeedsCreator = false;
  if (!hasSearch) {
    const result = buildSystemFilterConditions(conditions, queryParams, input.systemFilters);
    candNeedsCreator = result.needsCreatorJoin;
  }

  const candCreatorJoin = candNeedsCreator ? `LEFT JOIN "user" u ON r."createdById" = u.id` : "";

  const query = `
    SELECT r.id
    FROM "runs" r
    JOIN "projects" p ON r."projectId" = p.id
    ${candCreatorJoin}
    WHERE ${conditions.join(" AND ")}
  `;

  const rows: { id: bigint }[] = await ctx.prisma.$queryRawUnsafe(query, ...queryParams);
  return rows.map((r) => Number(r.id));
}

// ═══════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════

/** Build Prisma-style date WHERE clause */
function buildPrismaDateWhere(
  dateFilters?: { field: string; operator: string; value: string; value2?: string }[],
  skipIfSearchActive?: boolean,
): Record<string, any> {
  const dateWhere: Record<string, any> = {};
  if (skipIfSearchActive || !dateFilters?.length) return dateWhere;
  for (const df of dateFilters) {
    const existing = dateWhere[df.field] ?? {};
    if (df.operator === "before") {
      existing.lt = new Date(df.value);
    } else if (df.operator === "after") {
      existing.gt = new Date(df.value);
    } else if (df.operator === "between" && df.value2) {
      existing.gte = new Date(df.value);
      existing.lte = new Date(df.value2);
    }
    dateWhere[df.field] = existing;
  }
  return dateWhere;
}

/** Append date filter conditions to raw SQL query params */
function appendDateFiltersRaw(
  conditions: string[],
  queryParams: (string | bigint | string[] | number)[],
  dateFilters?: { field: string; operator: string; value: string; value2?: string }[],
) {
  if (!dateFilters?.length) return;
  const dateFieldMap: Record<string, string> = {
    createdAt: '"createdAt"',
    updatedAt: '"updatedAt"',
    statusUpdated: '"statusUpdated"',
  };
  for (const df of dateFilters) {
    const col = dateFieldMap[df.field];
    if (!col) continue;
    if (df.operator === "before") {
      queryParams.push(df.value);
      conditions.push(`r.${col} < $${queryParams.length}::timestamptz`);
    } else if (df.operator === "after") {
      queryParams.push(df.value);
      conditions.push(`r.${col} > $${queryParams.length}::timestamptz`);
    } else if (df.operator === "between" && df.value2) {
      queryParams.push(df.value);
      conditions.push(`r.${col} >= $${queryParams.length}::timestamptz`);
      queryParams.push(df.value2);
      conditions.push(`r.${col} <= $${queryParams.length}::timestamptz`);
    }
  }
}

/** Get SQL cast type for keyset cursor comparison */
function getSqlCastType(field: string): string {
  if (field === "name" || field === "notes") return "text";
  if (field === "runId") return "bigint";
  // createdAt, updatedAt, statusUpdated are all timestamps
  return "timestamptz";
}

/** Map negated operators to their positive equivalents.
 *  Negated field filters use NOT EXISTS with the positive condition
 *  so that runs without the field at all are correctly included. */
const NEGATED_TO_POSITIVE: Record<string, FieldFilterOperator> = {
  "does not contain": "contains",
  "is not": "is",
  "is not between": "is between",
  "is none of": "is any of",
};

/**
 * Resolve the set of run IDs matching a list of field filters, scoped to an
 * organization (and optionally a project). Reuses {@link buildFieldFilterConditions}
 * so the operator semantics are IDENTICAL to the tRPC runs.list path — the
 * OpenAPI/REST handler feeds the result into its existing Prisma query via
 * `id: { in: ... }` rather than re-implementing operators in Prisma.
 *
 * Returns an empty array when no filters are supplied (caller should treat this
 * as "no field-filter constraint", i.e. skip the id intersection).
 */
export async function queryFieldFilteredRunIds(
  prisma: { $queryRawUnsafe: (q: string, ...p: unknown[]) => Promise<{ id: bigint }[]> },
  input: {
    organizationId: string;
    projectId?: bigint;
    fieldFilters?: FieldFilter[];
  },
): Promise<bigint[]> {
  if (!input.fieldFilters?.length) return [];

  const conditions: string[] = [`r."organizationId" = $1`];
  const queryParams: (string | bigint | string[] | number)[] = [input.organizationId];

  if (input.projectId != null) {
    queryParams.push(input.projectId);
    conditions.push(`r."projectId" = $${queryParams.length}`);
  }

  buildFieldFilterConditions(conditions, queryParams, input.fieldFilters);

  const query = `
    SELECT r.id
    FROM "runs" r
    WHERE ${conditions.join(" AND ")}
  `;

  const rows = await prisma.$queryRawUnsafe(query, ...queryParams);
  return rows.map((row) => row.id);
}

/**
 * Resolve an ORDERED list of run IDs sorted by a single config/systemMetadata
 * field, scoped to an organization (and optionally a project). This is the
 * ONE shared implementation of the run_field_values ORDER BY used by BOTH the
 * tRPC runs.list `jsonFieldSortQuery` strategy and the REST `/api/runs/list`
 * `sort=config.*.value` / `sort=systemMetadata.*.value` path.
 *
 * Ordering semantics (identical to the tRPC keyset/JSON-sort path):
 *   - numericValue first, then textValue, both NULLS LAST in the chosen
 *     direction, with `createdAt DESC` as a deterministic tiebreaker.
 *   - `direction` is "asc" | "desc"; default behavior matches the caller.
 *
 * Filtering: callers may either pass a flat `idFilter` (REST — the candidate
 * set that already satisfies every non-sort filter) and/or a pre-assembled
 * `prefilter` (tRPC — its search CTE + conditions + params + creator join).
 * Both are optional; when neither is supplied the sort runs over the full
 * org/project scope.
 *
 * `offset` is clamped to {@link MAX_JSON_SORT_OFFSET} to cap deep pagination.
 */
export async function queryFieldSortedRunIds(
  prisma: { $queryRawUnsafe: (q: string, ...p: unknown[]) => Promise<{ id: bigint }[]> },
  input: {
    organizationId: string;
    projectId?: bigint;
    source: "config" | "systemMetadata";
    key: string;
    direction: "asc" | "desc";
    limit: number;
    offset?: number;
    /** Flat candidate id set (REST path); ordering+limit+offset apply within it. */
    idFilter?: bigint[];
    /**
     * Pre-assembled filter fragment from a caller that builds its own complex
     * WHERE (tRPC path). `conditions`/`params` are spliced verbatim; `searchCTE`
     * and `creatorJoin` are injected into the same positions the legacy inline
     * query used so behavior is byte-for-byte preserved.
     */
    prefilter?: {
      conditions: string[];
      params: (string | bigint | string[] | number)[];
      searchCTE?: string;
      creatorJoin?: string;
    };
  },
): Promise<bigint[]> {
  const offset = Math.min(input.offset ?? 0, MAX_JSON_SORT_OFFSET);
  const dir = input.direction === "asc" ? "ASC" : "DESC";
  const nullsOrder = "NULLS LAST";

  // Seed conditions/params from the caller-supplied prefilter (tRPC) or build
  // a minimal org/project scope ourselves (REST).
  const conditions: string[] = input.prefilter
    ? [...input.prefilter.conditions]
    : [`r."organizationId" = $1`];
  const queryParams: (string | bigint | string[] | number)[] = input.prefilter
    ? [...input.prefilter.params]
    : [input.organizationId];

  if (!input.prefilter && input.projectId != null) {
    queryParams.push(input.projectId);
    conditions.push(`r."projectId" = $${queryParams.length}`);
  }

  // Flat candidate id set (REST). Empty array means "no candidates" — short out.
  if (input.idFilter) {
    if (input.idFilter.length === 0) return [];
    // Postgres array param — matches the tRPC path's `r.id = ANY($N::bigint[])`.
    queryParams.push(input.idFilter as unknown as string[]);
    conditions.push(`r.id = ANY($${queryParams.length}::bigint[])`);
  }

  // Sort column join params come last so the $N indices stay stable.
  queryParams.push(input.source);
  const srcIdx = queryParams.length;
  queryParams.push(input.key);
  const keyIdx = queryParams.length;

  const sortExpr = `v."numericValue"`;
  const textSortExpr = `v."textValue"`;
  // The project JOIN is only needed when a caller filters on p.* (tRPC builds
  // `p.name = $N`); REST scopes by r."projectId" so it can skip the join, but
  // keeping it is harmless and keeps a single SQL shape.
  const projectJoin = input.prefilter ? `JOIN "projects" p ON r."projectId" = p.id` : "";
  const creatorJoin = input.prefilter?.creatorJoin ?? "";
  const searchCTE = input.prefilter?.searchCTE ?? "";

  const query = `
    WITH ${searchCTE}
    sorted AS (
      SELECT r.id
      FROM "runs" r
      ${projectJoin}
      ${creatorJoin}
      LEFT JOIN "run_field_values" v
        ON v."runId" = r.id AND v."source" = $${srcIdx} AND v."key" = $${keyIdx}
      WHERE ${conditions.join(" AND ")}
      ORDER BY ${sortExpr} ${dir} ${nullsOrder},
               ${textSortExpr} ${dir} ${nullsOrder},
               r."createdAt" DESC
      LIMIT ${input.limit}
      OFFSET ${offset}
    )
    SELECT id FROM sorted
  `;

  const rows = await prisma.$queryRawUnsafe(query, ...queryParams);
  return rows.map((row) => row.id);
}

/**
 * Append EXISTS subqueries for field filters against run_field_values.
 * Each filter becomes an EXISTS (or NOT EXISTS) clause correlated on r.id.
 *
 * Negated operators (e.g. "does not contain") use NOT EXISTS with the positive
 * condition so that rows without the field are included in the result.
 */
export function buildFieldFilterConditions(
  conditions: string[],
  queryParams: (string | bigint | string[] | number)[],
  fieldFilters?: FieldFilterCondition[],
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

    const baseJoin = `${alias}."runId" = r.id AND ${alias}."source" = $${srcIdx} AND ${alias}."key" = $${keyIdx}`;

    // "exists" / "not exists" operators — no value comparison needed
    if (ff.operator === "exists") {
      conditions.push(`EXISTS (SELECT 1 FROM "run_field_values" ${alias} WHERE ${baseJoin})`);
      continue;
    }
    if (ff.operator === "not exists") {
      conditions.push(`NOT EXISTS (SELECT 1 FROM "run_field_values" ${alias} WHERE ${baseJoin})`);
      continue;
    }

    // Check if this is a negated operator — if so, build the positive condition
    // and wrap in NOT EXISTS so that runs without the field are included.
    const positiveOp = NEGATED_TO_POSITIVE[ff.operator];
    if (positiveOp) {
      const positiveFilter = { ...ff, operator: positiveOp };
      const valueCond = buildValueCondition(alias, positiveFilter, queryParams);
      if (valueCond) {
        conditions.push(`NOT EXISTS (SELECT 1 FROM "run_field_values" ${alias} WHERE ${baseJoin} AND ${valueCond})`);
      }
    } else {
      // Positive operator — use EXISTS normally
      const valueCond = buildValueCondition(alias, ff, queryParams);
      if (valueCond) {
        conditions.push(`EXISTS (SELECT 1 FROM "run_field_values" ${alias} WHERE ${baseJoin} AND ${valueCond})`);
      }
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
    switch (operator) {
      case "is": {
        const n = Number(values[0]);
        if (isNaN(n)) return null;
        queryParams.push(n);
        return `${alias}."numericValue" = $${queryParams.length}`;
      }
      case "is not": {
        const n = Number(values[0]);
        if (isNaN(n)) return null;
        queryParams.push(n);
        return `(${alias}."numericValue" IS NULL OR ${alias}."numericValue" != $${queryParams.length})`;
      }
      case "is greater than":
      case ">": {
        const n = Number(values[0]);
        if (isNaN(n)) return null;
        queryParams.push(n);
        return `${alias}."numericValue" > $${queryParams.length}`;
      }
      case "is less than":
      case "<": {
        const n = Number(values[0]);
        if (isNaN(n)) return null;
        queryParams.push(n);
        return `${alias}."numericValue" < $${queryParams.length}`;
      }
      case "is greater than or equal to":
      case ">=": {
        const n = Number(values[0]);
        if (isNaN(n)) return null;
        queryParams.push(n);
        return `${alias}."numericValue" >= $${queryParams.length}`;
      }
      case "is less than or equal to":
      case "<=": {
        const n = Number(values[0]);
        if (isNaN(n)) return null;
        queryParams.push(n);
        return `${alias}."numericValue" <= $${queryParams.length}`;
      }
      case "is between": {
        const n1 = Number(values[0]);
        const n2 = Number(values[1]);
        if (isNaN(n1) || isNaN(n2)) return null;
        queryParams.push(n1);
        const lo = queryParams.length;
        queryParams.push(n2);
        const hi = queryParams.length;
        return `${alias}."numericValue" BETWEEN $${lo} AND $${hi}`;
      }
      case "is not between": {
        const n1 = Number(values[0]);
        const n2 = Number(values[1]);
        if (isNaN(n1) || isNaN(n2)) return null;
        queryParams.push(n1);
        const lo = queryParams.length;
        queryParams.push(n2);
        const hi = queryParams.length;
        return `(${alias}."numericValue" IS NULL OR ${alias}."numericValue" NOT BETWEEN $${lo} AND $${hi})`;
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

/**
 * Build SQL conditions for system field filters (name, status, tags, creator.name).
 * Returns whether a LEFT JOIN to "users" is needed for creator.name filters.
 */
export function buildSystemFilterConditions(
  conditions: string[],
  queryParams: (string | bigint | string[] | number)[],
  systemFilters?: z.infer<typeof systemFilterSchema>[],
): { needsCreatorJoin: boolean } {
  let needsCreatorJoin = false;
  if (!systemFilters?.length) return { needsCreatorJoin };

  for (const sf of systemFilters) {
    const { field, operator, values } = sf;

    if (field === "name") {
      const v = values[0] != null ? String(values[0]) : "";
      switch (operator) {
        case "contains": {
          queryParams.push(v);
          conditions.push(`r."name" ILIKE '%' || $${queryParams.length} || '%'`);
          break;
        }
        case "does not contain": {
          queryParams.push(v);
          conditions.push(`(r."name" IS NULL OR r."name" NOT ILIKE '%' || $${queryParams.length} || '%')`);
          break;
        }
      }
    } else if (field === "status") {
      switch (operator) {
        case "is": {
          const v = String(values[0]);
          queryParams.push(v);
          conditions.push(`r."status" = $${queryParams.length}::"RunStatus"`);
          break;
        }
        case "is not": {
          const v = String(values[0]);
          queryParams.push(v);
          conditions.push(`r."status" != $${queryParams.length}::"RunStatus"`);
          break;
        }
        case "is any of": {
          const arr = (Array.isArray(values[0]) ? values[0] : values).map(String);
          queryParams.push(arr as any);
          conditions.push(`r."status" = ANY($${queryParams.length}::"RunStatus"[])`);
          break;
        }
        case "is none of": {
          const arr = (Array.isArray(values[0]) ? values[0] : values).map(String);
          queryParams.push(arr as any);
          conditions.push(`r."status" != ALL($${queryParams.length}::"RunStatus"[])`);
          break;
        }
      }
    } else if (field === "tags") {
      // Tags are a text[] column — values is always wrapped in an inner array [["tag1","tag2"]]
      const tagValues = (Array.isArray(values[0]) ? values[0] : values).map(String);
      switch (operator) {
        case "include": {
          // Single tag must be present
          queryParams.push(tagValues[0]);
          conditions.push(`$${queryParams.length} = ANY(r.tags)`);
          break;
        }
        case "exclude": {
          // Single tag must NOT be present
          queryParams.push(tagValues[0]);
          conditions.push(`NOT ($${queryParams.length} = ANY(r.tags))`);
          break;
        }
        case "include any of": {
          // At least one of the given tags must be present (overlap)
          queryParams.push(tagValues as any);
          conditions.push(`r.tags && $${queryParams.length}::text[]`);
          break;
        }
        case "exclude if all": {
          // Exclude runs where ALL given tags are present
          queryParams.push(tagValues as any);
          conditions.push(`NOT (r.tags @> $${queryParams.length}::text[])`);
          break;
        }
        case "include all of": {
          // All given tags must be present
          queryParams.push(tagValues as any);
          conditions.push(`r.tags @> $${queryParams.length}::text[]`);
          break;
        }
        case "exclude if any of": {
          // Exclude runs where ANY of the given tags overlap
          queryParams.push(tagValues as any);
          conditions.push(`NOT (r.tags && $${queryParams.length}::text[])`);
          break;
        }
      }
    } else if (field === "creator.name") {
      needsCreatorJoin = true;
      const v = values[0] != null ? String(values[0]) : "";
      switch (operator) {
        case "contains": {
          queryParams.push(v);
          conditions.push(`u."name" ILIKE '%' || $${queryParams.length} || '%'`);
          break;
        }
        case "does not contain": {
          queryParams.push(v);
          conditions.push(`(u."name" IS NULL OR u."name" NOT ILIKE '%' || $${queryParams.length} || '%')`);
          break;
        }
      }
    } else if (field === "notes") {
      const v = values[0] != null ? String(values[0]) : "";
      switch (operator) {
        case "contains": {
          queryParams.push(v);
          conditions.push(`r."notes" ILIKE '%' || $${queryParams.length} || '%'`);
          break;
        }
        case "does not contain": {
          queryParams.push(v);
          conditions.push(`(r."notes" IS NULL OR r."notes" NOT ILIKE '%' || $${queryParams.length} || '%')`);
          break;
        }
        case "is": {
          queryParams.push(v);
          conditions.push(`r."notes" = $${queryParams.length}`);
          break;
        }
        case "is not": {
          queryParams.push(v);
          conditions.push(`(r."notes" IS NULL OR r."notes" != $${queryParams.length})`);
          break;
        }
        case "starts with": {
          queryParams.push(v);
          conditions.push(`r."notes" ILIKE $${queryParams.length} || '%'`);
          break;
        }
        case "ends with": {
          queryParams.push(v);
          conditions.push(`r."notes" ILIKE '%' || $${queryParams.length}`);
          break;
        }
        case "exists": {
          conditions.push(`r."notes" IS NOT NULL AND r."notes" != ''`);
          break;
        }
        case "not exists": {
          conditions.push(`(r."notes" IS NULL OR r."notes" = '')`);
          break;
        }
      }
    }
  }

  return { needsCreatorJoin };
}
