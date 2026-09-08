import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedOrgProcedure } from "../../../../lib/trpc";
import { resolveRunId } from "../../../../lib/resolve-run-id";

export const unmergeRunProcedure = protectedOrgProcedure
  .input(
    z.object({
      runId: z.string(),
      projectName: z.string(),
    })
  )
  .mutation(async ({ ctx, input }) => {
    const { projectName, organizationId } = input;
    const runId = await resolveRunId(
      ctx.prisma,
      input.runId,
      organizationId,
      projectName
    );

    // Atomic org/project-scoped clear; forkedFromRunId: { not: null } makes
    // "not merged" indistinguishable from "not found" — both are count 0.
    const result = await ctx.prisma.runs.updateMany({
      where: {
        id: runId,
        organizationId,
        project: { name: projectName },
        forkedFromRunId: { not: null },
      },
      data: { forkedFromRunId: null, forkStep: null },
    });

    if (result.count === 0) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Run not found, not linked, or you don't have access to it.",
      });
    }

    return { runId: input.runId };
  });
