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
 *  At 100k rows, OFFSET > 10k + full JSON extract is too slow. */
const MAX_JSON_SORT_OFFSET = 100_000;

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
    limit: number;
    cursor?: number;
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

  const runs = await ctx.prisma.runs.findMany({
    where: {
      project: { name: input.projectName },
      organizationId: input.organizationId,
      ...(searchMatchIds ? { id: { in: searchMatchIds } } : {}),
      ...(!searchMatchIds && input.tags?.length ? { tags: { hasSome: input.tags } } : {}),
      ...(!searchMatchIds && input.status?.length ? { status: { in: input.status } } : {}),
      ...dateWhere,
    },
    orderBy: { createdAt: input.direction === "forward" ? "desc" : "asc" },
    select: {
      id: true, name: true, number: true, status: true, statusUpdated: true,
      createdAt: true, updatedAt: true, tags: true, notes: true, externalId: true,
      creator: { select: { name: true, email: true } },
      project: { select: { runPrefix: true } },
    },
    take: input.limit,
    skip: input.cursor ? 1 : 0,
    cursor: input.cursor ? { id: input.cursor } : undefined,
  });

  const nextCursor = runs.length === input.limit ? runs[runs.length - 1].id : null;
  return {
    runs: runs.map((r: any) => ({ ...r, id: sqidEncode(r.id) })),
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
    limit: number;
    cursor?: number;
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

  // Cursor pagination
  const dir = input.direction === "forward" ? "DESC" : "ASC";
  if (input.cursor) {
    queryParams.push(BigInt(input.cursor) as any);
    conditions.push(`r.id ${input.direction === "forward" ? "<" : ">"} $${queryParams.length}::bigint`);
  }

  const creatorJoin = needsCreatorJoin ? `LEFT JOIN "user" u ON r."createdById" = u.id` : "";

  const query = `
    SELECT r.id
    FROM "runs" r
    JOIN "projects" p ON r."projectId" = p.id
    ${creatorJoin}
    WHERE ${conditions.join(" AND ")}
    ORDER BY r."createdAt" ${dir}
    LIMIT ${input.limit}
  `;

  const rows: { id: bigint }[] = await ctx.prisma.$queryRawUnsafe(query, ...queryParams);
  if (rows.length === 0) return { runs: [], nextCursor: null, nextOffset: null };

  const runs = await ctx.prisma.runs.findMany({
    where: { id: { in: rows.map((r) => r.id) } },
    select: {
      id: true, name: true, number: true, status: true, statusUpdated: true,
      createdAt: true, updatedAt: true, tags: true, notes: true, externalId: true,
      creator: { select: { name: true, email: true } },
      project: { select: { runPrefix: true } },
    },
  });

  const idOrder = new Map(rows.map((r, i) => [r.id, i]));
  runs.sort((a: any, b: any) => (idOrder.get(a.id) ?? 0) - (idOrder.get(b.id) ?? 0));

  const nextCursor = runs.length === input.limit ? runs[runs.length - 1].id : null;
  return {
    runs: runs.map((r: any) => ({ ...r, id: sqidEncode(r.id) })),
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
    limit: number;
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

  // Keyset pagination: WHERE (sortCol, id) > ($cursorVal, $cursorId)
  if (input.sortCursor) {
    const parts = input.sortCursor.split("::");
    if (parts.length === 2) {
      const cursorVal = parts[0];
      const cursorId = parts[1];
      // Use row-value comparison for correct keyset behavior
      // For nullable columns, NULLs need special handling but for the common case
      // where cursor exists, the value is non-null
      queryParams.push(cursorVal);
      const valIdx = queryParams.length;
      queryParams.push(BigInt(cursorId) as any);
      const idIdx = queryParams.length;
      // Row-value comparison: (col, id) > (cursorVal, cursorId) for ASC
      // or (col, id) < (cursorVal, cursorId) for DESC
      conditions.push(`(r.${sqlCol}, r.id) ${gtLt} ($${valIdx}::${getSqlCastType(field)}, $${idIdx}::bigint)`);
    }
  }

  const sysCreatorJoin = sysNeedsCreator ? `LEFT JOIN "user" u ON r."createdById" = u.id` : "";

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
      creator: { select: { name: true, email: true } },
      project: { select: { runPrefix: true } },
    },
  });

  // Re-sort to match SQL order
  const idOrder = new Map(rows.map((r, i) => [r.id, i]));
  runs.sort((a: any, b: any) => (idOrder.get(a.id) ?? 0) - (idOrder.get(b.id) ?? 0));

  // Build next keyset cursor from last row
  const lastRow = rows[rows.length - 1];
  const nextSortCursor = rows.length === input.limit
    ? `${lastRow.sort_val instanceof Date ? lastRow.sort_val.toISOString() : String(lastRow.sort_val)}::${lastRow.id}`
    : null;

  return {
    runs: runs.map((r: any) => ({ ...r, id: sqidEncode(r.id) })),
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
    limit: number;
    sortField?: string;
    sortSource?: "system" | "config" | "systemMetadata" | "metric";
    sortDirection?: "asc" | "desc";
    offset?: number;
  },
) {
  const offset = Math.min(input.offset ?? 0, MAX_JSON_SORT_OFFSET);
  const dir = input.sortDirection === "asc" ? "ASC" : "DESC";
  const nullsOrder = "NULLS LAST";
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

  // LEFT JOIN run_field_values for the sort column
  queryParams.push(sortSource);
  const srcIdx = queryParams.length;
  queryParams.push(sortKey);
  const keyIdx = queryParams.length;

  // Determine sort expression — use numericValue if the column has numeric data
  const sortExpr = `v."numericValue"`;
  const textSortExpr = `v."textValue"`;

  const jsonCreatorJoin = jsonNeedsCreator ? `LEFT JOIN "user" u ON r."createdById" = u.id` : "";

  const query = `
    WITH ${searchCTE}
    sorted AS (
      SELECT r.id
      FROM "runs" r
      JOIN "projects" p ON r."projectId" = p.id
      ${jsonCreatorJoin}
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

  const sortedIds: { id: bigint }[] = await ctx.prisma.$queryRawUnsafe(query, ...queryParams);

  if (sortedIds.length === 0) {
    return { runs: [], nextCursor: null, nextOffset: null };
  }

  // Fetch full records
  const runs = await ctx.prisma.runs.findMany({
    where: { id: { in: sortedIds.map((r) => r.id) } },
    select: {
      id: true, name: true, number: true, status: true, statusUpdated: true,
      createdAt: true, updatedAt: true, tags: true, notes: true, externalId: true,
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

  return {
    runs: runs.map((r: any) => ({ ...r, id: sqidEncode(r.id) })),
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
    limit: number;
    sortField?: string;
    sortAggregation?: string;
    sortDirection?: "asc" | "desc";
    offset?: number;
  },
) {
  const offset = Math.min(input.offset ?? 0, MAX_JSON_SORT_OFFSET);
  const sortLogName = input.sortField!;
  const sortAggregation = (input.sortAggregation ?? "LAST") as MetricAggregation;
  const sortDirection = input.sortDirection === "asc" ? "ASC" as const : "DESC" as const;

  // Phase 1: Get candidate run IDs from PostgreSQL (all filters except metric)
  const candidateRunIds = await getCandidateRunIds(ctx, input);

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

  if (sortedRows.length === 0) {
    return { runs: [], nextCursor: null, nextOffset: null };
  }

  // Phase 3: Fetch full records from PostgreSQL
  const sortedRunIds = sortedRows.map((r) => BigInt(r.runId));
  const runs = await ctx.prisma.runs.findMany({
    where: { id: { in: sortedRunIds } },
    select: {
      id: true, name: true, number: true, status: true, statusUpdated: true,
      createdAt: true, updatedAt: true, tags: true, notes: true, externalId: true,
      creator: { select: { name: true, email: true } },
      project: { select: { runPrefix: true } },
    },
  });

  // Re-sort to match ClickHouse order
  const idOrder = new Map(sortedRows.map((r, i) => [BigInt(r.runId), i]));
  runs.sort((a: any, b: any) => (idOrder.get(a.id) ?? 0) - (idOrder.get(b.id) ?? 0));

  const nextOffset = sortedRows.length === input.limit && offset + sortedRows.length <= MAX_JSON_SORT_OFFSET
    ? offset + sortedRows.length
    : null;

  return {
    runs: runs.map((r: any) => ({ ...r, id: sqidEncode(r.id) })),
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
const NEGATED_TO_POSITIVE: Record<string, string> = {
  "does not contain": "contains",
  "is not": "is",
  "is not between": "is between",
  "is none of": "is any of",
};

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
  fieldFilters?: z.infer<typeof fieldFilterSchema>[],
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
  ff: z.infer<typeof fieldFilterSchema>,
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
