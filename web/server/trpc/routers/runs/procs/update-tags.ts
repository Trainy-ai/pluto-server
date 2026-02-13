import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedOrgProcedure } from "../../../../lib/trpc";
import { resolveRunId } from "../../../../lib/resolve-run-id";
import { triggerLinearSyncForTags } from "../../../../lib/linear-sync";

export const updateTagsProcedure = protectedOrgProcedure
  .input(
    z.object({
      runId: z.string(),
      projectName: z.string(),
      tags: z.array(z.string()),
    })
  )
  .mutation(async ({ ctx, input }) => {
    const { runId: encodedRunId, projectName, tags, organizationId } = input;

    const runId = await resolveRunId(ctx.prisma, encodedRunId, organizationId, projectName);

    // Fetch old tags before update so we can sync removed linear: tags
    const existingRun = await ctx.prisma.runs.findFirst({
      where: { id: runId, organizationId },
      select: { tags: true },
    });
    const previousTags = existingRun?.tags ?? [];

    // Perform authorization check and update in a single atomic operation
    // to avoid TOCTOU vulnerability
    const result = await ctx.prisma.runs.updateMany({
      where: {
        id: runId,
        organizationId: organizationId,
        project: {
          name: projectName,
        },
      },
      data: { tags },
    });

    if (result.count === 0) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Run not found or you don't have access to it.",
      });
    }

    // updateMany doesn't return the updated record, so we fetch it again
    const updatedRun = await ctx.prisma.runs.findUnique({
      where: { id: runId },
    });

    if (!updatedRun) {
      // This is unlikely but possible if the run is deleted between the update and fetch
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Failed to retrieve the updated run.",
      });
    }

    // Fire-and-forget Linear sync for any linear: tags (including removed ones)
    triggerLinearSyncForTags(ctx.prisma, organizationId, tags, previousTags);

    return updatedRun;
  });
