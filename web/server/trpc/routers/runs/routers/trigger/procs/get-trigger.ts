import { z } from "zod";
import { protectedOrgProcedure } from "../../../../../../lib/trpc";
import { resolveRunId } from "../../../../../../lib/resolve-run-id";

export const getTrigger = protectedOrgProcedure
  .input(
    z.object({
      runId: z.string(),
      projectName: z.string(),
    })
  )
  .query(async ({ ctx, input }) => {
    const { runId: encodedRunId, projectName, organizationId } = input;
    const runId = await resolveRunId(ctx.prisma, encodedRunId, organizationId, projectName);

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
