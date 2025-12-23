import { InvitationStatus } from "@prisma/client";
import { protectedProcedure } from "../../../../../../lib/trpc";

export const myInvitesProcedure = protectedProcedure.query(async ({ ctx }) => {
  return ctx.prisma.invitation.findMany({
    where: {
      email: ctx.user.email,
      status: InvitationStatus.PENDING,
    },
    include: {
      organization: {
        select: {
          name: true,
          slug: true,
        },
      },
      user: {
        select: {
          name: true,
          email: true,
        },
      },
    },
  });
});
