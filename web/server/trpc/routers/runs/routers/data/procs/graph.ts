import { z } from "zod";
import { protectedOrgProcedure } from "../../../../../../lib/trpc";
import { sqidDecode } from "../../../../../../lib/sqid";
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
    })
  )
  .query(async ({ ctx, input }) => {
    const { runId: encodedRunId, projectName, organizationId, logName } = input;

    const runId = sqidDecode(encodedRunId);
    const logGroup = getLogGroupName(logName);

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
