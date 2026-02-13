import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedOrgProcedure } from "../../../../../../lib/trpc";
import { encrypt } from "../../../../../../lib/encryption";
import { validateApiKey } from "../../../../../../lib/linear-client";

export const saveLinearApiKeyProcedure = protectedOrgProcedure
  .input(
    z.object({
      apiKey: z.string().min(1),
    })
  )
  .mutation(async ({ ctx, input }) => {
    // Check admin role
    if (ctx.member.role !== "OWNER" && ctx.member.role !== "ADMIN") {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Only admins can manage integrations",
      });
    }

    // Validate the key with Linear API
    let viewer;
    try {
      viewer = await validateApiKey(input.apiKey);
    } catch {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Invalid Linear API key. Please check your key and try again.",
      });
    }

    const encryptedToken = encrypt(input.apiKey);

    await ctx.prisma.integration.upsert({
      where: {
        organizationId_provider: {
          organizationId: input.organizationId,
          provider: "linear",
        },
      },
      update: {
        encryptedToken,
        enabled: true,
        config: {
          workspaceSlug: viewer.organization.urlKey,
          workspaceName: viewer.organization.name,
        },
        metadata: {},
      },
      create: {
        organizationId: input.organizationId,
        provider: "linear",
        encryptedToken,
        enabled: true,
        config: {
          workspaceSlug: viewer.organization.urlKey,
          workspaceName: viewer.organization.name,
        },
        metadata: {},
        createdById: ctx.user.id,
      },
    });

    return {
      workspaceSlug: viewer.organization.urlKey,
      workspaceName: viewer.organization.name,
    };
  });
