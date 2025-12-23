import { z } from "zod";
import { protectedOrgProcedure } from "../../../../../../lib/trpc";
import { sqidDecode } from "../../../../../../lib/sqid";

export const getTrigger = protectedOrgProcedure
  .input(
    z.object({
      runId: z.string(),
      projectName: z.string(),
    })
  )
  .query(async ({ ctx, input }) => {
    const { runId: encodedRunId, projectName } = input;
    const runId = sqidDecode(encodedRunId);

    const triggers = await ctx.prisma.runTriggers.findMany({
      where: {
        runId,
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    return triggers;
  });
