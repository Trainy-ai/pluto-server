import { sqidEncode } from "../../../../../../lib/sqid";
import { protectedOrgProcedure } from "../../../../../../lib/trpc";
import { z } from "zod";

export const listNotificationsProcedure = protectedOrgProcedure
  .input(
    z.object({
      limit: z.number().optional().default(10),
      cursor: z.number().nullish(),
      read: z.boolean().optional().default(false),
    })
  )
  .query(async ({ ctx, input }) => {
    const { organizationId, limit, cursor, read } = input;

    const notifications = await ctx.prisma.notification.findMany({
      take: limit + 1,
      where: {
        organizationId: organizationId,
        read: read,
        ...(cursor
          ? {
              id: {
                lt: cursor,
              },
            }
          : {}),
      },
      orderBy: {
        id: "desc",
      },
      select: {
        id: true,
        type: true,
        content: true,
        createdAt: true,
        read: true,
        run: {
          select: {
            id: true,
            name: true,
            project: {
              select: {
                name: true,
              },
            },
          },
        },
      },
    });

    let nextCursor: number | null = null;
    if (notifications.length > limit) {
      const nextItem = notifications.pop();
      nextCursor = Number(nextItem?.id) ?? null;
    }

    const encodedNotifications = notifications.map((notification) => ({
      ...notification,
      run: notification.run
        ? {
            ...notification.run,
            id: sqidEncode(notification.run.id),
          }
        : null,
    }));

    return {
      items: encodedNotifications,
      nextCursor,
    };
  });
