import { z } from "zod";
import { protectedOrgProcedure } from "../../../../lib/trpc";
import { queryDistinctMetrics } from "../../../../lib/queries/metric-summaries";
import { sqidDecode } from "../../../../lib/sqid";

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
      regex: z.string().max(200).optional(),
      runIds: z.array(z.string()).optional(),
    })
  )
  .query(async ({ ctx, input }) => {
    const numericRunIds = input.runIds?.map((sqid) => sqidDecode(sqid));

    const metricNames = await queryDistinctMetrics(ctx.clickhouse, {
      organizationId: input.organizationId,
      projectName: input.projectName,
      search: input.search,
      regex: input.regex,
      runIds: numericRunIds,
      // No limit when scoped to specific runs — return all metric names
      ...(numericRunIds && numericRunIds.length > 0 ? { limit: 10000 } : {}),
    });

    return { metricNames };
  });
