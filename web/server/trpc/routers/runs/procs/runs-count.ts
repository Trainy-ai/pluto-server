import { z } from "zod";
import { protectedOrgProcedure } from "../../../../lib/trpc";
import { countRunsWithSearch } from "../../../../lib/run-search";
import { buildFieldFilterConditions, buildSystemFilterConditions } from "./list-runs";
import { queryMetricFilteredRunIds } from "../../../../lib/queries/metric-summaries";

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

export const countRunsProcedure = protectedOrgProcedure
  .input(
    z.object({
      projectName: z.string(),
      search: z.string().optional(),
      tags: z.array(z.string()).optional(),
      status: z.array(z.enum(["RUNNING", "COMPLETED", "FAILED", "TERMINATED", "CANCELLED"])).optional(),
      dateFilters: z.array(dateFilterSchema).optional(),
      fieldFilters: z.array(fieldFilterSchema).optional(),
      metricFilters: z.array(metricFilterSchema).optional(),
      systemFilters: z.array(systemFilterSchema).optional(),
    })
  )
  .query(async ({ ctx, input }) => {
    // If search is provided, use search count
    if (input.search && input.search.trim()) {
      return countRunsWithSearch(ctx.prisma, {
        organizationId: input.organizationId,
        projectName: input.projectName,
        search: input.search.trim(),
        tags: input.tags,
        status: input.status,
        dateFilters: input.dateFilters,
      });
    }

    // Use raw SQL when any advanced filters are present
    const hasFieldFilters = input.fieldFilters && input.fieldFilters.length > 0;
    const hasMetricFilters = input.metricFilters && input.metricFilters.length > 0;
    const hasSystemFilters = input.systemFilters && input.systemFilters.length > 0;

    if (hasFieldFilters || hasMetricFilters || hasSystemFilters) {
      const conditions: string[] = [];
      const queryParams: (string | bigint | string[] | number)[] = [];

      // Project join
      queryParams.push(input.projectName);
      conditions.push(`p."name" = $${queryParams.length}`);

      queryParams.push(input.organizationId);
      conditions.push(`r."organizationId" = $${queryParams.length}`);

      // Tags
      if (input.tags && input.tags.length > 0) {
        queryParams.push(input.tags);
        conditions.push(`r."tags" && $${queryParams.length}::text[]`);
      }

      // Status
      if (input.status && input.status.length > 0) {
        queryParams.push(input.status as unknown as string[]);
        conditions.push(`r."status" = ANY($${queryParams.length}::"RunStatus"[])`);
      }

      // Date filters
      if (input.dateFilters && input.dateFilters.length > 0) {
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

      // Field filters (EXISTS subqueries on run_field_values)
      if (hasFieldFilters) {
        buildFieldFilterConditions(conditions, queryParams, input.fieldFilters);
      }

      // Metric filters — query ClickHouse for matching run IDs
      if (hasMetricFilters && input.metricFilters) {
        const mfRunIds = await queryMetricFilteredRunIds(ctx.clickhouse, {
          organizationId: input.organizationId,
          projectName: input.projectName,
          metricFilters: input.metricFilters,
        });
        if (mfRunIds.length === 0) return 0;
        queryParams.push(mfRunIds.map((id) => BigInt(id)) as any);
        conditions.push(`r.id = ANY($${queryParams.length}::bigint[])`);
      }

      // System filters (name, status, tags, creator.name, notes)
      let needsCreatorJoin = false;
      if (hasSystemFilters) {
        const result = buildSystemFilterConditions(conditions, queryParams, input.systemFilters);
        needsCreatorJoin = result.needsCreatorJoin;
      }

      const creatorJoin = needsCreatorJoin
        ? `LEFT JOIN "user" u ON r."createdById" = u.id`
        : "";
      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
      const sql = `SELECT COUNT(*)::int as count FROM "runs" r JOIN "projects" p ON r."projectId" = p."id" ${creatorJoin} ${whereClause}`;

      const result = await ctx.prisma.$queryRawUnsafe<{ count: number }[]>(sql, ...queryParams);
      return result[0]?.count ?? 0;
    }

    // Build date filter where clauses for Prisma
    const dateWhere: Record<string, any> = {};
    if (input.dateFilters && input.dateFilters.length > 0) {
      for (const df of input.dateFilters) {
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
    }

    // Standard count without search
    const runs = await ctx.prisma.runs.count({
      where: {
        project: {
          name: input.projectName,
        },
        organizationId: input.organizationId,
        ...(input.tags && input.tags.length > 0 && {
          tags: {
            hasSome: input.tags,
          },
        }),
        ...(input.status && input.status.length > 0 && {
          status: {
            in: input.status,
          },
        }),
        ...dateWhere,
      },
    });

    return runs;
  });
