import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedOrgProcedure } from "../../../../lib/trpc";
import { resolveRunIds } from "../../../../lib/resolve-run-id";
import { sqidEncode } from "../../../../lib/sqid";
import {
  planMergeChain,
  getStepBoundsByRunId,
  collectAncestorIds,
  MergePlanError,
} from "../../../../lib/merge-helpers";

export const mergeRunsProcedure = protectedOrgProcedure
  .input(
    z.object({
      // SQID or display IDs, any order — the server chains them by createdAt.
      runIds: z.array(z.string()).min(2).max(10),
      projectName: z.string(),
    })
  )
  .mutation(async ({ ctx, input }) => {
    const { projectName, organizationId } = input;

    const numericIds = await resolveRunIds(
      ctx.prisma,
      input.runIds,
      organizationId,
      projectName
    );
    const uniqueIds = [...new Set(numericIds.map((id) => BigInt(id)))];
    if (uniqueIds.length < 2) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Select at least two distinct runs to merge.",
      });
    }

    const runs = await ctx.prisma.runs.findMany({
      where: {
        id: { in: uniqueIds },
        organizationId,
        project: { name: projectName },
      },
      select: { id: true, name: true, createdAt: true, forkedFromRunId: true },
    });
    if (runs.length !== uniqueIds.length) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message:
          "One or more runs were not found or you don't have access to them.",
      });
    }

    const boundsByRunId = await getStepBoundsByRunId(
      ctx.clickhouse,
      organizationId,
      projectName,
      uniqueIds
    );

    const ancestorSets = new Map<bigint, Set<bigint>>();
    for (const r of runs) {
      ancestorSets.set(
        r.id,
        await collectAncestorIds(ctx.prisma, r.id, organizationId)
      );
    }

    let plan;
    try {
      plan = planMergeChain(
        runs,
        boundsByRunId,
        (id) => ancestorSets.get(id) ?? new Set<bigint>()
      );
    } catch (err) {
      if (err instanceof MergePlanError) {
        throw new TRPCError({ code: err.code, message: err.message });
      }
      throw err;
    }

    // Apply all links atomically. forkedFromRunId: null in the WHERE makes a
    // concurrent merge/fork conflict (count 0 → rollback) instead of being
    // silently overwritten — same TOCTOU stance as update-tags.ts.
    await ctx.prisma.$transaction(async (tx) => {
      for (const link of plan.links) {
        const res = await tx.runs.updateMany({
          where: {
            id: link.childId,
            organizationId,
            project: { name: projectName },
            forkedFromRunId: null,
          },
          data: {
            forkedFromRunId: link.parentId,
            forkStep: BigInt(link.forkStep),
          },
        });
        if (res.count === 0) {
          throw new TRPCError({
            code: "CONFLICT",
            message:
              "A selected run was linked by someone else while merging. Reload and try again.",
          });
        }
      }
    });

    return {
      links: plan.links.map((l) => ({
        runId: sqidEncode(l.childId),
        parentRunId: sqidEncode(l.parentId),
        forkStep: l.forkStep,
      })),
      alreadyLinked: plan.alreadyLinked.map((id) => sqidEncode(id)),
    };
  });
