import { protectedOrgProcedure } from "../../../../lib/trpc";

export const listMembersProcedure = protectedOrgProcedure.query(
  async ({ ctx, input }) => {
    return ctx.prisma.member.findMany({
      where: {
        organizationId: input.organizationId,
      },
      select: {
        id: true,
        role: true,
        user: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });
  }
);
