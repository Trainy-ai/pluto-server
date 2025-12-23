import { z } from "zod";
import { protectedOrgProcedure } from "../../../../../../lib/trpc";

export const notificationCountProcedure = protectedOrgProcedure
  .input(
    z.object({
      read: z.boolean().optional().default(false),
    })
  )
  .query(async ({ ctx, input }) => {
    const { organizationId, read } = input;

    const count = await ctx.prisma.notification.count({
      where: {
        organizationId,
        read,
      },
    });

    return count;
  });
