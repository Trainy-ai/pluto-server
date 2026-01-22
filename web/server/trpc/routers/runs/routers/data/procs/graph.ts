import { z } from "zod";
import { protectedOrgProcedure } from "../../../../../../lib/trpc";
import { sqidDecode } from "../../../../../../lib/sqid";
import { getLogGroupName } from "../../../../../../lib/utilts";
import { withCache } from "../../../../../../lib/cache";

// Maximum number of data points to return per query
// ECharts applies LTTB sampling on the frontend for smooth visualization
const MAX_POINTS = 2000;

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
    const clickhouse = ctx.clickhouse;
    const { runId: encodedRunId, projectName, organizationId, logName } = input;

    const runId = sqidDecode(encodedRunId);
    const logGroup = getLogGroupName(logName);

    return withCache<GraphData>(
      ctx,
      "graph",
      { runId, organizationId, projectName, logName, logGroup },
      async () => {
        // Single optimized query with reservoir sampling approach
        // Uses ClickHouse window functions to count and sample in one pass
        const query = `
          WITH counted AS (
            SELECT
              value,
              time,
              step,
              count() OVER () as total_rows,
              row_number() OVER (ORDER BY step ASC) as rn
            FROM mlop_metrics
            WHERE tenantId = {tenantId: String}
              AND projectName = {projectName: String}
              AND runId = {runId: String}
              AND logName = {logName: String}
              AND logGroup = {logGroup: String}
          )
          SELECT value, time, step
          FROM counted
          WHERE total_rows <= ${MAX_POINTS}
             OR rn % ceiling(total_rows / ${MAX_POINTS}) = 1
             OR rn = total_rows  -- Always include last point
          ORDER BY step ASC
        `;

        const metrics = await clickhouse.query(query, {
          tenantId: organizationId,
          projectName: projectName,
          runId: runId,
          logName: logName,
          logGroup: logGroup,
        });

        return (await metrics.json()) as GraphData;
      }
    );
  });
