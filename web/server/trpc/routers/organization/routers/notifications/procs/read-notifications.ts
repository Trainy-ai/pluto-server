import { z } from "zod";
import { protectedOrgProcedure } from "../../../../../../lib/trpc";

export const readNotificationsProcedure = protectedOrgProcedure
  .input(z.object({ notificationIds: z.array(z.number()) }))
  .mutation(async ({ ctx, input }) => {
    const { notificationIds, organizationId } = input;

    await ctx.prisma.notification.updateMany({
      where: { id: { in: notificationIds }, organizationId: organizationId },
      data: { read: true },
    });
  });
