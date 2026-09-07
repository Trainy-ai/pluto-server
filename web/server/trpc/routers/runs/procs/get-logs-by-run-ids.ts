import { z } from "zod";
import { protectedOrgProcedure } from "../../../../lib/trpc";
import { sqidDecode, sqidEncode } from "../../../../lib/sqid";

// Mirrors MAX_LINEAGE_DEPTH in get-lineage.ts — log discovery must cover
// exactly the chain the metric stitcher will read.
const MAX_LINEAGE_DEPTH = 10;

/**
 * For each requested run (chain ordered child-first), union its ancestors'
 * log rows, deduped by logName with the closest descendant winning.
 * Generic so the Prisma-inferred row type (nullable logGroup, RunLogType
 * enum) flows through to the response unchanged. Exported for unit tests.
 */
export function buildLineageLogUnion<T extends { logName: string }>(
  chains: Map<bigint, bigint[]>,
  logsByOwner: Map<bigint, T[]>,
): Map<bigint, T[]> {
  const result = new Map<bigint, T[]>();
  for (const [requestedId, chain] of chains) {
    const seen = new Set<string>();
    const rows: T[] = [];
    for (const ownerId of chain) {
      for (const row of logsByOwner.get(ownerId) ?? []) {
        if (seen.has(row.logName)) {
          continue;
        }
        seen.add(row.logName);
        rows.push(row);
      }
    }
    result.set(requestedId, rows);
  }
  return result;
}

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
      select: { id: true, forkedFromRunId: true },
    });

    if (validRuns.length === 0) {
      return {};
    }

    // Walk each run's lineage upward in batched rounds so a forked/merged
    // run also surfaces metrics only its ancestors logged. Ancestors stay
    // org-scoped; depth-capped like the metric stitcher.
    const chains = new Map<bigint, bigint[]>(
      validRuns.map((r) => [r.id, [r.id]])
    );
    let pending = new Map<bigint, bigint>(
      validRuns.flatMap((r) =>
        r.forkedFromRunId ? [[r.id, r.forkedFromRunId] as const] : []
      )
    );
    for (let depth = 0; depth < MAX_LINEAGE_DEPTH && pending.size > 0; depth++) {
      const ancestorIds = [...new Set(pending.values())];
      const ancestors = await ctx.prisma.runs.findMany({
        where: { id: { in: ancestorIds }, organizationId: input.organizationId },
        select: { id: true, forkedFromRunId: true },
      });
      const byId = new Map(ancestors.map((a) => [a.id, a]));
      const next = new Map<bigint, bigint>();
      for (const [requestedId, ancestorId] of pending) {
        const ancestor = byId.get(ancestorId);
        if (!ancestor) {
          continue;
        }
        const chain = chains.get(requestedId);
        if (!chain || chain.includes(ancestor.id)) {
          continue; // defensive: cycle
        }
        chain.push(ancestor.id);
        if (ancestor.forkedFromRunId) {
          next.set(requestedId, ancestor.forkedFromRunId);
        }
      }
      pending = next;
    }

    const allInvolvedIds = [...new Set([...chains.values()].flat())];

    // Single batch query — select only the fields the frontend needs.
    // The @@unique([runId, logName]) constraint means there's at most one row
    // per metric name per run, so the old per-run 1000 limit is rarely hit.
    const allLogs = await ctx.prisma.runLogs.findMany({
      where: { runId: { in: allInvolvedIds } },
      select: { runId: true, logGroup: true, logName: true, logType: true },
      orderBy: { id: "asc" },
    });

    const logsByOwner = new Map<bigint, typeof allLogs>();
    for (const log of allLogs) {
      const list = logsByOwner.get(log.runId) ?? [];
      list.push(log);
      logsByOwner.set(log.runId, list);
    }

    const unioned = buildLineageLogUnion(chains, logsByOwner);

    const logsByRunId: Record<string, typeof allLogs> = {};
    for (const [requestedId, rows] of unioned) {
      logsByRunId[sqidEncode(requestedId)] = rows;
    }
    return logsByRunId;
  });
