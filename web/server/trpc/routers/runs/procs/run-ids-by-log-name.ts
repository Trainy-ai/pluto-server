import { protectedOrgProcedure } from "../../../../lib/trpc";
import { sqidDecode, sqidEncode } from "../../../../lib/sqid";
import { getCached, setCached, buildBatchCacheKey } from "../../../../lib/cache";
import { runIdsByLogNameInput } from "./run-ids-by-log-name.schema";

/** Fixed 30s TTL — mirrors distinctFileLogNamesProcedure, whose rows this
 *  reads. Dedupes the burst of identical calls each dashboard widget makes
 *  per render. */
const RUN_IDS_BY_LOG_TTL = 30 * 1000;

/**
 * Which of the given runs actually logged each of the given log names.
 *
 * Dashboard widgets are config-driven: a widget stores a log name (or a glob
 * that resolves to some), but nothing tells it which runs have that log, so it
 * sends the whole selection to filesBatch / histogramBatch and discards the
 * runs that come back empty. That wastes the request and — because those procs
 * cap `runIds` at 200 — makes a large selection unrenderable even when only a
 * handful of runs have the data. The comparison page doesn't need this: its
 * grouped-metrics pipeline already knows which runs log what.
 *
 * `run_logs` is the registry for exactly this ((runId, logName) unique, ~36k
 * indexed rows against 920M in mlop_metrics), so the mapping is a cheap
 * Postgres lookup rather than a ClickHouse scan.
 *
 * NOTE: deliberately not capped at 200 runs like the data procs — the whole
 * point is to be callable with a selection bigger than they accept. The bound
 * here is URL/query size, not per-run work.
 */
export const runIdsByLogNameProcedure = protectedOrgProcedure
  .input(runIdsByLogNameInput)
  .query(async ({ ctx, input }) => {
    const numericRunIds = input.runIds
      .map((sqid) => sqidDecode(sqid))
      .filter((id): id is number => Number.isFinite(id));

    const cacheKey = buildBatchCacheKey("runIdsByLogName", {
      orgId: input.organizationId,
      projectName: input.projectName,
      logNames: input.logNames,
      runIds: numericRunIds,
    });

    const cached =
      await getCached<{ runIdsByLogName: Record<string, string[]> }>(cacheKey);
    if (cached) return cached;

    const project = await ctx.prisma.projects.findFirst({
      where: {
        name: input.projectName,
        organizationId: input.organizationId,
      },
      select: { id: true },
    });

    if (!project || numericRunIds.length === 0) {
      // Same contract as the success path: every requested name present, so a
      // caller never mistakes this for an unresolved lookup.
      return {
        runIdsByLogName: Object.fromEntries(
          input.logNames.map((logName) => [logName, [] as string[]]),
        ) as Record<string, string[]>,
      };
    }

    const rows = await ctx.prisma.runLogs.findMany({
      where: {
        logName: { in: input.logNames },
        runId: { in: numericRunIds.map((id) => BigInt(id)) },
        run: {
          projectId: project.id,
          organizationId: input.organizationId,
        },
      },
      select: { logName: true, runId: true },
    });

    // Seed every REQUESTED name, not just the ones with rows: an absent key is
    // indistinguishable from "lookup hasn't resolved", and callers fail open on
    // the latter. Without this, a log that none of the selected runs have makes
    // the widget fall back to sending the entire selection — the exact request
    // this proc exists to avoid.
    //
    // Encode back to SQIDs so callers can compare against the run ids they
    // already hold without a second translation.
    const runIdsByLogName: Record<string, string[]> = Object.fromEntries(
      input.logNames.map((logName) => [logName, [] as string[]]),
    );
    for (const row of rows) {
      const encoded = sqidEncode(row.runId);
      runIdsByLogName[row.logName]?.push(encoded);
    }

    const result = { runIdsByLogName };
    await setCached(cacheKey, result, RUN_IDS_BY_LOG_TTL);
    return result;
  });
