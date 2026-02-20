import { z } from "zod";
import { protectedOrgProcedure } from "../../../../lib/trpc";
import { sqidDecode, sqidEncode } from "../../../../lib/sqid";

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

    // Single batch query — select only the fields the frontend needs.
    // The @@unique([runId, logName]) constraint means there's at most one row
    // per metric name per run, so the old per-run 1000 limit is rarely hit.
    const allLogs = await ctx.prisma.runLogs.findMany({
      where: { runId: { in: validRunIds } },
      select: { runId: true, logGroup: true, logName: true, logType: true },
      orderBy: { id: "asc" },
    });

    // Group by runId
    const logsByRunId: Record<string, typeof allLogs> = {};

    for (const log of allLogs) {
      const encodedRunId = sqidEncode(log.runId);
      if (!logsByRunId[encodedRunId]) {
        logsByRunId[encodedRunId] = [];
      }
      logsByRunId[encodedRunId].push(log);
    }

    return logsByRunId;
  });
