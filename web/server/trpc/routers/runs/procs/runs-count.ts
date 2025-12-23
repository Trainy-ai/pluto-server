import { z } from "zod";
import { protectedOrgProcedure } from "../../../../lib/trpc";

export const countRunsProcedure = protectedOrgProcedure
  .input(
    z.object({
      projectName: z.string(),
    })
  )
  .query(async ({ ctx, input }) => {
    const runs = await ctx.prisma.runs.count({
      where: {
        project: {
          name: input.projectName,
        },
        organizationId: input.organizationId,
      },
    });

    return runs;
  });
