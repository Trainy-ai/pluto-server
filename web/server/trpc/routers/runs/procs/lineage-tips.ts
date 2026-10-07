import { z } from "zod";
import { protectedOrgProcedure } from "../../../../lib/trpc";
import { resolveRunIdsResilient } from "../../../../lib/resolve-run-id";
import { sqidEncode } from "../../../../lib/sqid";

/** Mirrors MAX_LINEAGE_DEPTH in get-lineage.ts / lineage-helpers.ts. */
const MAX_LINEAGE_DEPTH = 10;

/**
 * For each given run that another run continues, the tip of its lineage —
 * when that tip is unambiguous (the chain below the run never branches).
 *
 * Experiments mode holds one tip per experiment. A selection carried in from
 * Runs mode (or a ?runs= link) can name an ancestor without its tip; the
 * client swaps it for the tip returned here. Runs that are already tips, and
 * runs whose descendants branch, are omitted: picking every branch would turn
 * one selected base run into dozens of selected forks.
 */
export const lineageTipsProcedure = protectedOrgProcedure
  .input(
    z.object({
      projectName: z.string(),
      runIds: z.array(z.string()).max(1000),
    }),
  )
  .query(async ({ ctx, input }) => {
    const { projectName, organizationId, runIds } = input;
    const tipIdByRunId: Record<string, string> = {};
    if (runIds.length === 0) return { tipIdByRunId };

    const resolved = await resolveRunIdsResilient(ctx.prisma, runIds, organizationId, projectName);
    if (resolved.length === 0) return { tipIdByRunId };

    // Re-scope to this org + project: resolution decodes SQIDs without a lookup.
    const owned = await ctx.prisma.runs.findMany({
      where: {
        id: { in: resolved.map((r) => BigInt(r.num)) },
        organizationId,
        project: { name: projectName },
      },
      select: { id: true, projectId: true },
    });
    if (owned.length === 0) return { tipIdByRunId };
    const ownedIds = new Set(owned.map((r) => Number(r.id)));
    const projectId = owned[0].projectId;

    // Walk descendants level by level (one indexed findMany per level). One
    // level past the hop cap, so a tip exactly MAX_LINEAGE_DEPTH hops down
    // is confirmed childless rather than dropped.
    const childrenOf = new Map<number, number[]>();
    const queried = new Set<number>(); // runs whose children we looked up
    let frontier = [...ownedIds];
    const visited = new Set(frontier);
    for (let depth = 0; depth <= MAX_LINEAGE_DEPTH && frontier.length > 0; depth++) {
      for (const id of frontier) queried.add(id);
      const children: Array<{ id: bigint; forkedFromRunId: bigint | null }> =
        await ctx.prisma.runs.findMany({
          where: {
            forkedFromRunId: { in: frontier.map((id) => BigInt(id)) },
            organizationId,
            projectId,
          },
          select: { id: true, forkedFromRunId: true },
        });
      const next: number[] = [];
      for (const child of children) {
        const parent = Number(child.forkedFromRunId);
        const id = Number(child.id);
        const siblings = childrenOf.get(parent) ?? [];
        siblings.push(id);
        childrenOf.set(parent, siblings);
        if (!visited.has(id)) {
          visited.add(id);
          next.push(id);
        }
      }
      frontier = next;
    }

    for (const { enc, num } of resolved) {
      if (!ownedIds.has(num)) continue;
      let tip = num;
      let ambiguous = false;
      const walked = new Set([tip]);
      for (let depth = 0; depth < MAX_LINEAGE_DEPTH; depth++) {
        const kids = childrenOf.get(tip) ?? [];
        if (kids.length === 0) break;
        if (kids.length > 1 || walked.has(kids[0])) {
          ambiguous = true;
          break;
        }
        tip = kids[0];
        walked.add(tip);
      }
      // A chain deeper than the cap stops short of the tip — don't guess.
      if (!ambiguous && tip !== num && queried.has(tip) && !childrenOf.has(tip)) {
        tipIdByRunId[enc] = sqidEncode(tip);
      }
    }
    return { tipIdByRunId };
  });
