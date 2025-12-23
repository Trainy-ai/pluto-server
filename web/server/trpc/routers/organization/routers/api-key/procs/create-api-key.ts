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
      isSecured: z.boolean().optional().default(true),
    })
  )
  .mutation(async ({ ctx, input }) => {
    const generatedKey = generateApiKey(input.isSecured);
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
        isHashed: input.isSecured,
        createdAt: new Date(),
        expiresAt: input.expiresAt,
      },
    });

    return { apiKey: generatedKey };
  });
