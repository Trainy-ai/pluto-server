import { z } from "zod";
import { protectedOrgProcedure } from "../../../../../../lib/trpc";
import { resolveRunId } from "../../../../../../lib/resolve-run-id";
import { withCache } from "../../../../../../lib/cache";
import { queryAllRunLogs } from "../../../../../../lib/queries";

type LogData = {
  logType: string;
  message: string;
  time: Date;
  lineNumber: number;
}[];

export const logsProcedure = protectedOrgProcedure
  .input(z.object({ runId: z.string(), projectName: z.string(), logType: z.string().optional() }))
  .query(async ({ ctx, input }) => {
    const { runId: encodedRunId, projectName, organizationId, logType } = input;

    const runId = await resolveRunId(ctx.prisma, encodedRunId, organizationId, projectName);

    return withCache<LogData>(
      ctx,
      "logs",
      { runId, organizationId, projectName, logType },
      async () => {
        const logs = await queryAllRunLogs(ctx.clickhouse, {
          organizationId,
          projectName,
          runId,
          logType,
        });

        return logs.map((log) => ({
          ...log,
          time: new Date(log.time + "Z"), // Add Z to make it UTC
        }));
      }
    );
  });
