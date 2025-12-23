import { protectedOrgProcedure } from "../../../../../../lib/trpc";

export const listApiKeysProcedure = protectedOrgProcedure.query(
  async ({ ctx, input }) => {
    const keys = await ctx.prisma.apiKey.findMany({
      where: { organizationId: input.organizationId },
      select: {
        id: true,
        name: true,
        keyString: true,
        expiresAt: true,
        isHashed: true,
        createdAt: true,
        lastUsed: true,
        user: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });

    return keys;
  }
);
