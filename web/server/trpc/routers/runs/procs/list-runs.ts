import { z } from "zod";
import { protectedOrgProcedure } from "../../../../lib/trpc";
import { sqidEncode } from "../../../../lib/sqid";

// Maximum number of logs to fetch per run to prevent OOM
// If a run has more logs than this, they'll need to be fetched via runs.get
const MAX_LOGS_PER_RUN = 1000;

export const listRunsProcedure = protectedOrgProcedure
  .input(
    z.object({
      projectName: z.string(),
      tags: z.array(z.string()).optional(),
      status: z.array(z.enum(["RUNNING", "COMPLETED", "FAILED", "TERMINATED", "CANCELLED"])).optional(),
      limit: z.number().min(1).max(200).default(10),
      cursor: z.number().optional(),
      direction: z.enum(["forward", "backward"]).default("forward"),
    })
  )
  .query(async ({ ctx, input }) => {
    // First, fetch runs WITHOUT logs to avoid loading unbounded data
    const runs = await ctx.prisma.runs.findMany({
      where: {
        project: {
          name: input.projectName,
        },
        organizationId: input.organizationId,
        ...(input.tags && input.tags.length > 0
          ? { tags: { hasSome: input.tags } }
          : {}),
        ...(input.status && input.status.length > 0
          ? { status: { in: input.status } }
          : {}),
      },
      orderBy: {
        createdAt: input.direction === "forward" ? "desc" : "asc",
      },
      take: input.limit,
      cursor: input.cursor ? { id: input.cursor } : undefined,
    });

    // Then fetch logs separately with a limit per run to prevent OOM
    // This is bounded: max 200 runs × 1000 logs = 200k records (vs unbounded millions)
    const runIds = runs.map((r) => r.id);
    const allLogs = runIds.length > 0
      ? await ctx.prisma.runLogs.findMany({
          where: { runId: { in: runIds } },
          orderBy: { id: "asc" },
        })
      : [];

    // Group logs by runId and limit per run
    const logsByRunId = new Map<bigint, typeof allLogs>();
    for (const log of allLogs) {
      const existing = logsByRunId.get(log.runId) || [];
      if (existing.length < MAX_LOGS_PER_RUN) {
        existing.push(log);
        logsByRunId.set(log.runId, existing);
      }
    }

    const nextCursor =
      runs.length === input.limit ? runs[runs.length - 1].id : null;

    // Combine runs with their logs and encode the id
    const encodedRuns = runs.map((run) => ({
      ...run,
      id: sqidEncode(run.id),
      logs: logsByRunId.get(run.id) || [],
    }));

    return {
      runs: encodedRuns,
      nextCursor,
    };
  });
