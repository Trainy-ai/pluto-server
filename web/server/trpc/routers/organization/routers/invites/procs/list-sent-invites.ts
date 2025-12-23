import { protectedOrgProcedure } from "../../../../../../lib/trpc";

export const listSentInvitesProcedure = protectedOrgProcedure.query(
  async ({ ctx, input }) => {
    const data = await ctx.prisma.invitation.findMany({
      where: {
        organizationId: input.organizationId,
      },
      select: {
        id: true,
        email: true,
        role: true,
        status: true,
        expiresAt: true,
        user: {
          select: {
            name: true,
            email: true,
          },
        },
      },
    });

    // rename the .user field to .inviter and remove the .user field
    return data.map((invitation) => ({
      ...invitation,
      inviter: invitation.user,
      user: undefined,
    }));
  }
);
