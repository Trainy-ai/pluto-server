import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { OrganizationRole } from "@prisma/client";
import { protectedOrgProcedure } from "../../../../../../lib/trpc";
import { startProCheckout } from "../../../../../../lib/pro-checkout";
import { env } from "../../../../../../lib/env";

export const createCheckoutSessionProcedure = protectedOrgProcedure
  .input(
    z.object({
      organizationId: z.string(),
    })
  )
  .mutation(async ({ ctx, input }) => {
    // Only owners and admins can upgrade
    if (
      ctx.member.role !== OrganizationRole.OWNER &&
      ctx.member.role !== OrganizationRole.ADMIN
    ) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Only organization owners and admins can manage billing",
      });
    }

    const baseUrl = env.BETTER_AUTH_URL;
    return startProCheckout({
      organizationId: input.organizationId,
      customerEmail: ctx.user.email,
      returnUrls: (orgSlug) => ({
        successUrl: `${baseUrl}/o/${orgSlug}/settings/org/billing?success=true`,
        cancelUrl: `${baseUrl}/o/${orgSlug}/settings/org/billing?cancelled=true`,
      }),
    });
  });
