import { z } from "zod";
import { protectedOrgProcedure } from "../../../../../../lib/trpc";
import { resolveRunId } from "../../../../../../lib/resolve-run-id";
import { getLogGroupName } from "../../../../../../lib/utilts";
import { withCache } from "../../../../../../lib/cache";
import { queryRunMetricsByLogName } from "../../../../../../lib/queries";

// Type for graph data returned by this procedure
type GraphData = {
  value: number;
  time: string;
  step: number;
}[];

export const graphProcedure = protectedOrgProcedure
  .input(
    z.object({
      runId: z.string(),
      projectName: z.string(),
      logName: z.string(),
      stepMin: z.number().int().nonnegative().optional(),
      stepMax: z.number().int().nonnegative().optional(),
      maxPoints: z.number().int().nonnegative().max(10_000_000).optional(),
      preview: z.boolean().optional(),
    })
  )
  .query(async ({ ctx, input }) => {
    const { runId: encodedRunId, projectName, organizationId, logName, stepMin, stepMax, maxPoints, preview } = input;

    const runId = await resolveRunId(ctx.prisma, encodedRunId, organizationId, projectName);
    const logGroup = getLogGroupName(logName);

    // Non-default maxPoints, preview queries, and step-range queries bypass cache
    if (maxPoints !== undefined || preview || (stepMin !== undefined && stepMax !== undefined)) {
      return queryRunMetricsByLogName(ctx.clickhouse, {
        organizationId,
        projectName,
        runId,
        logName,
        stepMin,
        stepMax,
        maxPoints,
        preview,
      });
    }

    return withCache<GraphData>(
      ctx,
      "graph",
      { runId, organizationId, projectName, logName, logGroup },
      async () => {
        return queryRunMetricsByLogName(ctx.clickhouse, {
          organizationId,
          projectName,
          runId,
          logName,
        });
      }
    );
  });
