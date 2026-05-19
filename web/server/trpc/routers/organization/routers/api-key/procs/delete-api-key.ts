import { protectedOrgProcedure } from "../../../../../../lib/trpc";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

export const deleteApiKeyProcedure = protectedOrgProcedure
  .input(z.object({ apiKeyId: z.string() }))
  .mutation(async ({ ctx, input }) => {
    // Soft-delete: API keys are revoked, not removed. Runs reference their
    // creator key via Runs.creatorApiKeyId (a required FK with RESTRICT), so a
    // hard delete throws once the key has logged any run. Revoked keys are
    // rejected at every auth path and hidden from listApiKeys.
    // Scoped to the org so the update is authorized.
    const { count } = await ctx.prisma.apiKey.updateMany({
      where: {
        id: input.apiKeyId,
        organizationId: input.organizationId,
        revokedAt: null,
      },
      data: { revokedAt: new Date() },
    });

    if (count === 0) {
      // updateMany matched nothing: either the key isn't in this org, or it
      // was already revoked. Distinguish the two so the call is idempotent —
      // re-revoking an already-revoked key succeeds, while a genuinely missing
      // key still 404s.
      const existing = await ctx.prisma.apiKey.findFirst({
        where: {
          id: input.apiKeyId,
          organizationId: input.organizationId,
        },
        select: { id: true },
      });
      if (!existing) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "API key not found",
        });
      }
      // Key exists but was already revoked — idempotent no-op.
    }

    return { success: true };
  });
