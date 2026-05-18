import { apiKeyToStore } from "../../../../../../lib/api-key";

import { z } from "zod";
import { protectedOrgProcedure } from "../../../../../../lib/trpc";
import { generateApiKey } from "../../../../../../lib/api-key";
import { TRPCError } from "@trpc/server";
import { nanoid } from "nanoid";
import { createKeyString } from "../../../../../../lib/api-key";

export const createApiKeyProcedure = protectedOrgProcedure
  .input(
    z.object({
      name: z.string(),
      expiresAt: z.date().optional(),
    })
  )
  .mutation(async ({ ctx, input }) => {
    // API keys are always created as secure (hashed). Insecure plaintext keys
    // are no longer offered; existing `mlpi_` keys remain valid via the
    // prefix-based lookup in keyToSearchFor (see lib/api-key.ts).
    const generatedKey = generateApiKey(true);
    const hashedKey = await apiKeyToStore(generatedKey);

    if (input.expiresAt) {
      const expiresAt = new Date(input.expiresAt);
      if (expiresAt < new Date()) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Expires at date must be in the future",
        });
      }
    }

    const _ = await ctx.prisma.apiKey.create({
      data: {
        id: nanoid(),
        name: input.name,
        organizationId: input.organizationId,
        userId: ctx.user.id,
        key: hashedKey,
        keyString: createKeyString(generatedKey),
        isHashed: true,
        createdAt: new Date(),
        expiresAt: input.expiresAt,
      },
    });

    return { apiKey: generatedKey };
  });
