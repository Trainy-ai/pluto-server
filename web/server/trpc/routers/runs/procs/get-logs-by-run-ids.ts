import { z } from "zod";
import { protectedOrgProcedure } from "../../../../lib/trpc";
import { sqidDecode, sqidEncode } from "../../../../lib/sqid";

// Maximum logs per run to prevent excessive memory usage
const MAX_LOGS_PER_RUN = 1000;

export const getLogsByRunIdsProcedure = protectedOrgProcedure
  .input(
    z.object({
      runIds: z.array(z.string()), // SQID-encoded run IDs
      projectName: z.string(),
    })
  )
  .query(async ({ ctx, input }) => {
    if (input.runIds.length === 0) {
      return {};
    }

    // Decode SQID run IDs
    const decodedIds = input.runIds.map(sqidDecode);

    // Verify runs belong to the organization and project
    const validRuns = await ctx.prisma.runs.findMany({
      where: {
        id: { in: decodedIds },
        organizationId: input.organizationId,
        project: {
          name: input.projectName,
        },
      },
      select: { id: true },
    });

    const validRunIds = validRuns.map((r) => r.id);

    if (validRunIds.length === 0) {
      return {};
    }

    // Fetch logs for each run ID separately to ensure the MAX_LOGS_PER_RUN limit is applied per run.
    // This avoids one run with many logs from starving others. While this makes N queries (where N is the number of run IDs),
    // it is more correct. The number of selected runs is expected to be small (max 50).
    const logsPerRun = await Promise.all(
      validRunIds.map((runId) =>
        ctx.prisma.runLogs.findMany({
          where: { runId },
          orderBy: { id: "asc" },
          take: MAX_LOGS_PER_RUN,
        })
      )
    );

    // Group logs by runId
    const logsByRunId: Record<string, typeof logsPerRun[number]> = {};

    for (const logs of logsPerRun) {
      if (logs.length === 0) continue;
      const encodedRunId = sqidEncode(logs[0].runId);
      logsByRunId[encodedRunId] = logs;
    }

    return logsByRunId;
  });
