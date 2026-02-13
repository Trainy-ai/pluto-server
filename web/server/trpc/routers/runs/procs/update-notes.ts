import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedOrgProcedure } from "../../../../lib/trpc";
import { resolveRunId } from "../../../../lib/resolve-run-id";

export const updateNotesProcedure = protectedOrgProcedure
  .input(
    z.object({
      runId: z.string(),
      projectName: z.string(),
      notes: z.string().max(1000).nullable(),
    })
  )
  .mutation(async ({ ctx, input }) => {
    const { runId: encodedRunId, projectName, notes, organizationId } = input;

    const runId = await resolveRunId(ctx.prisma, encodedRunId, organizationId, projectName);

    // Perform authorization check and update in a single atomic operation
    const result = await ctx.prisma.runs.updateMany({
      where: {
        id: runId,
        organizationId: organizationId,
        project: {
          name: projectName,
        },
      },
      data: { notes: notes || null },
    });

    if (result.count === 0) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Run not found or you don't have access to it.",
      });
    }

    const updatedRun = await ctx.prisma.runs.findUnique({
      where: { id: runId },
    });

    if (!updatedRun) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Failed to retrieve the updated run.",
      });
    }

    return updatedRun;
  });
