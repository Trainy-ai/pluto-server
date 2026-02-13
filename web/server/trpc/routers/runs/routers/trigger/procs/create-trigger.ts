import { RunTriggerType } from "@prisma/client";
import { z } from "zod";
import { protectedOrgProcedure } from "../../../../../../lib/trpc";
import { resolveRunId } from "../../../../../../lib/resolve-run-id";

export const createTrigger = protectedOrgProcedure
  .input(
    z.object({
      runId: z.string(),
      projectName: z.string(),
      triggerType: z.nativeEnum(RunTriggerType),
    })
  )
  .mutation(async ({ ctx, input }) => {
    const { runId: encodedRunId, projectName, triggerType, organizationId } = input;

    const runId = await resolveRunId(ctx.prisma, encodedRunId, organizationId, projectName);

    await ctx.prisma.runTriggers.create({
      data: {
        runId,
        triggerType,
        trigger: projectName,
      },
    });

    return {
      success: true,
    };
  });
