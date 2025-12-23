import { z } from "zod";
import { protectedOrgProcedure } from "../../../../lib/trpc";

export const projectCountProcedure = protectedOrgProcedure
  .input(z.object({ organizationId: z.string() }))
  .query(async ({ ctx, input }) => {
    const count = await ctx.prisma.projects.count({
      where: {
        organizationId: input.organizationId,
      },
    });
    return count;
  });
