import { z } from "zod";
import { protectedOrgProcedure } from "../../../../../../lib/trpc";
import { sqidDecode } from "../../../../../../lib/sqid";

export const logsProcedure = protectedOrgProcedure
  .input(z.object({ runId: z.string(), projectName: z.string() }))
  .query(async ({ ctx, input }) => {
    const { runId: encodedRunId, projectName, organizationId } = input;

    const runId = sqidDecode(encodedRunId);

    const query = `
    SELECT * FROM mlop_logs
    WHERE tenantId = {tenantId: String}
    AND projectName = {projectName: String}
    AND runId = {runId: UInt64}
    ORDER BY lineNumber ASC
  `;

    const logs = await ctx.clickhouse.query(query, {
      tenantId: organizationId,
      projectName: projectName,
      runId: runId,
    });

    const logsData = (await logs.json()) as {
      logType: string;
      message: string;
      time: string;
      lineNumber: number;
    }[];

    return logsData.map((log) => ({
      ...log,
      time: new Date(log.time + "Z"), // Add Z to make it UTC
    }));
  });
