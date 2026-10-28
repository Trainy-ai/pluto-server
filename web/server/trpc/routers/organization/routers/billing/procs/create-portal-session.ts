import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { OrganizationRole, SubscriptionPlan } from "@prisma/client";
import { protectedOrgProcedure } from "../../../../../../lib/trpc";
import {
  createPortalSession,
  isStripeConfigured,
} from "../../../../../../lib/stripe";
import { env } from "../../../../../../lib/env";

export const createPortalSessionProcedure = protectedOrgProcedure
  .input(
    z.object({
      organizationId: z.string(),
    })
  )
  .mutation(async ({ ctx, input }) => {
    // Check if Stripe is configured
    if (!isStripeConfigured()) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "Billing is not configured. Please contact support.",
      });
    }

    // Only owners and admins can manage billing
    if (
      ctx.member.role !== OrganizationRole.OWNER &&
      ctx.member.role !== OrganizationRole.ADMIN
    ) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Only organization owners and admins can manage billing",
      });
    }

    // Get the organization and its current subscription
    const organization = await ctx.prisma.organization.findUnique({
      where: { id: input.organizationId },
      include: {
        // eslint-disable-next-line @mlop/no-unbounded-prisma-include -- 1:1 relation
        OrganizationSubscription: true,
      },
    });

    if (!organization) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Organization not found",
      });
    }

    // Must be on PRO and have a valid Stripe customer
    if (organization.OrganizationSubscription?.plan !== SubscriptionPlan.PRO) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Organization is not on the PRO plan",
      });
    }

    const customerId =
      organization.OrganizationSubscription?.stripeCustomerId;
    // Placeholders ("", "TODO") on hand-provisioned orgs would make Stripe 500
    if (!customerId?.startsWith("cus_")) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message:
          "Billing hasn't been set up for this organization yet.",
      });
    }

    // Create Stripe portal session
    const returnUrl = `${env.BETTER_AUTH_URL}/o/${organization.slug}/settings/org/billing`;

    const session = await createPortalSession({
      customerId,
      returnUrl,
    });

    return {
      portalUrl: session.url,
    };
  });
