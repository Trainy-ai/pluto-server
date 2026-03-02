import { z } from "zod";
import { protectedOrgProcedure } from "../../../../../../lib/trpc";
import { resolveRunId } from "../../../../../../lib/resolve-run-id";
import { withCache } from "../../../../../../lib/cache";
import {
  queryRunMetricValues,
  type RunMetricValue,
} from "../../../../../../lib/queries/metric-summaries";

/**
 * Fetch all metric latest values for a single run.
 * Used by the file view to display metrics alongside files (Neptune-style).
 */
export const metricValuesProcedure = protectedOrgProcedure
  .input(
    z.object({
      runId: z.string(),
      projectName: z.string(),
    })
  )
  .query(async ({ ctx, input }) => {
    const { runId: encodedRunId, projectName, organizationId } = input;

    const runId = await resolveRunId(ctx.prisma, encodedRunId, organizationId, projectName);

    return withCache<RunMetricValue[]>(
      ctx,
      "metricValues",
      { runId, organizationId, projectName },
      async () => {
        return queryRunMetricValues(ctx.clickhouse, {
          organizationId,
          projectName,
          runId,
        });
      },
    );
  });
