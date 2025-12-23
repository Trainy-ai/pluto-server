import { z } from "zod";
import { protectedOrgProcedure } from "../../../../../../lib/trpc";
import { sqidDecode } from "../../../../../../lib/sqid";
import { getLogGroupName } from "../../../../../../lib/utilts";

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

    // Fetch the total number of rows for the given metric
    const totalRowsResult = await clickhouse.query(
      `SELECT count(*) as total 
    FROM mlop_metrics 
    WHERE tenantId = {tenantId: String} 
    AND projectName = {projectName: String} 
    AND runId = {runId: UInt64}
    AND logName = {logName: String}
    AND logGroup = {logGroup: String}`,
      {
        tenantId: organizationId,
        projectName: projectName,
        runId: runId,
        logName: logName,
        logGroup: logGroup,
      }
    );

    const totalRowsData = (await totalRowsResult.json()) as {
      total: number;
    }[];

    const totalRows = totalRowsData[0]?.total || 0;

    // Determine the subsampling rate, ensuring at least one row is selected
    const subsampleRate = Math.max(1, Math.ceil(totalRows / 1000));
    const samplingWhereClause =
      subsampleRate > 1 ? `WHERE rn % ${subsampleRate} = 1` : "";

    const query = `
    SELECT value, time, step
    FROM (
      SELECT value, time, step, rowNumberInAllBlocks() AS rn 
      FROM mlop_metrics
      WHERE tenantId = {tenantId: String}
      AND projectName = {projectName: String}
      AND runId = {runId: String}
      AND logName = {logName: String}
      AND logGroup = {logGroup: String}
    )
    ${samplingWhereClause}
    ORDER BY step ASC
`;

    const metrics = await clickhouse.query(query, {
      tenantId: organizationId,
      projectName: projectName,
      runId: runId,
      logName: logName,
      logGroup: logGroup,
    });

    const metricsData = (await metrics.json()) as {
      value: number;
      time: string;
      step: number;
    }[];

    console.log("length", metricsData.length);

    return metricsData;
  });
