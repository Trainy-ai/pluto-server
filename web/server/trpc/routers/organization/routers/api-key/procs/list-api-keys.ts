import { protectedOrgProcedure } from "../../../../../../lib/trpc";

export const listApiKeysProcedure = protectedOrgProcedure.query(
  async ({ ctx, input }) => {
    const keys = await ctx.prisma.apiKey.findMany({
      // Revoked keys are soft-deleted — exclude them so the UI matches the
      // pre-soft-delete "the key is gone" behavior.
      where: { organizationId: input.organizationId, revokedAt: null },
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
