import { RunTriggerType } from "@prisma/client";
import { z } from "zod";
import { protectedOrgProcedure } from "../../../../../../lib/trpc";
import { sqidDecode } from "../../../../../../lib/sqid";

export const createTrigger = protectedOrgProcedure
  .input(
    z.object({
      runId: z.string(),
      projectName: z.string(),
      triggerType: z.nativeEnum(RunTriggerType),
    })
  )
  .mutation(async ({ ctx, input }) => {
    const { runId: encodedRunId, projectName, triggerType } = input;

    const runId = sqidDecode(encodedRunId);

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
