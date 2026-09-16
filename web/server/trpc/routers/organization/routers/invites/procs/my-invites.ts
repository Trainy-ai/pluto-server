import { InvitationStatus } from "@prisma/client";
import { protectedProcedure } from "../../../../../../lib/trpc";

export const myInvitesProcedure = protectedProcedure.query(async ({ ctx }) => {
  return ctx.prisma.invitation.findMany({
    // eslint-disable-next-line @mlop/require-org-scope -- user-scoped by design: the caller's own pending invitations
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
