import { protectedOrgProcedure } from "../../../../../../lib/trpc";
import { z } from "zod";

export const deleteApiKeyProcedure = protectedOrgProcedure
  .input(z.object({ apiKeyId: z.string() }))
  .mutation(async ({ ctx, input }) => {
    await ctx.prisma.apiKey.delete({
      where: { id: input.apiKeyId },
    });

    return { success: true };
  });
