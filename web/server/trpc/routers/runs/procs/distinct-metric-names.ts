import { z } from "zod";
import { protectedOrgProcedure } from "../../../../lib/trpc";
import { queryDistinctMetrics } from "../../../../lib/queries/metric-summaries";
import { sqidDecode } from "../../../../lib/sqid";
import { getCached, setCached, buildBatchCacheKey } from "../../../../lib/cache";

/** Fixed 30s TTL — deduplicates the 5-10 identical calls per page load */
const DISTINCT_METRICS_TTL = 30 * 1000;

/**
 * Discover all distinct metric names in a project.
 * Queries ClickHouse metric summaries table directly — fast prefix scan on ORDER BY key.
 * Optionally scoped to specific run IDs (SQID-encoded) for side-by-side view.
 */
export const distinctMetricNamesProcedure = protectedOrgProcedure
  .input(
    z.object({
      projectName: z.string(),
      search: z.string().optional(),
      regex: z.string().max(500).optional(),
      runIds: z.array(z.string()).optional(),
      /** When true, query the raw metrics table to include metrics whose values
       *  are all NaN/Inf. Default false — uses the faster summaries table. */
      includeNonFiniteMetrics: z.boolean().optional(),
    })
  )
  .query(async ({ ctx, input }) => {
    const numericRunIds = input.runIds?.map((sqid) => sqidDecode(sqid));

    const cacheKey = buildBatchCacheKey("distinctMetricNames", {
      orgId: input.organizationId,
      projectName: input.projectName,
      search: input.search,
      regex: input.regex,
      runIds: numericRunIds ?? [],
      // Include the toggle in the cache key so the summaries-table result
      // (toggle OFF) doesn't mask the raw-table result (toggle ON) — they
      // return different metric sets and need separate cache entries.
      includeNonFiniteMetrics: input.includeNonFiniteMetrics ?? false,
    });

    const cached = await getCached<{ metricNames: string[]; nonFiniteOnlyMetrics: string[] }>(cacheKey);
    if (cached) return cached;

    const result = await queryDistinctMetrics(ctx.clickhouse, {
      organizationId: input.organizationId,
      projectName: input.projectName,
      search: input.search,
      regex: input.regex,
      runIds: numericRunIds,
      includeNonFiniteMetrics: input.includeNonFiniteMetrics,
      // No limit when scoped to specific runs — return all metric names
      ...(numericRunIds && numericRunIds.length > 0 ? { limit: 10000 } : {}),
    });

    await setCached(cacheKey, result, DISTINCT_METRICS_TTL);
    return result;
  });
