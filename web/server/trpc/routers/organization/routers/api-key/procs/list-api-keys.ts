import { liveApiKeyWhere } from "../../../../../../lib/api-key";
import { protectedOrgProcedure } from "../../../../../../lib/trpc";

export const listApiKeysProcedure = protectedOrgProcedure.query(
  async ({ ctx, input }) => {
    const keys = await ctx.prisma.apiKey.findMany({
      // Only keys that can still authenticate. Revoked keys are soft-deleted
      // (so the UI matches the pre-soft-delete "the key is gone" behavior),
      // and an expired key is equally dead — showing one alongside live keys
      // presents access that lapsed as access someone still holds.
      where: liveApiKeyWhere(input.organizationId),
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
