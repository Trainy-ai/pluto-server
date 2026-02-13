import { TRPCError } from "@trpc/server";
import { protectedOrgProcedure } from "../../../../../../lib/trpc";
import { encrypt } from "../../../../../../lib/encryption";
import { getLinearOAuthUrl } from "../../../../../../lib/linear-oauth";
import { env } from "../../../../../../lib/env";

export const getLinearOAuthUrlProcedure = protectedOrgProcedure
  .mutation(async ({ ctx, input }) => {
    // Check admin role
    if (ctx.member.role !== "OWNER" && ctx.member.role !== "ADMIN") {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Only admins can manage integrations",
      });
    }

    if (!env.LINEAR_OAUTH_CLIENT_ID || !env.LINEAR_OAUTH_CLIENT_SECRET) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "Linear OAuth is not configured on this server",
      });
    }

    // Look up org slug for the redirect URL
    const org = await ctx.prisma.organization.findUnique({
      where: { id: input.organizationId },
      select: { slug: true },
    });

    if (!org) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Organization not found",
      });
    }

    // Build encrypted state for CSRF protection
    const redirectUrl = `${env.BETTER_AUTH_URL}/o/${org.slug}/settings/org/integrations`;

    const state = encrypt(
      JSON.stringify({
        organizationId: input.organizationId,
        userId: ctx.user.id,
        redirectUrl,
        exp: Date.now() + 10 * 60 * 1000, // 10 minute expiry
      })
    );

    const url = getLinearOAuthUrl(state);

    return { url };
  });
