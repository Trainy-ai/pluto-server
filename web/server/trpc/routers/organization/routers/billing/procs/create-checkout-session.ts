import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { OrganizationRole, SubscriptionPlan } from "@prisma/client";
import { protectedOrgProcedure } from "../../../../../../lib/trpc";
import {
  createCheckoutSession,
  isStripeConfigured,
} from "../../../../../../lib/stripe";
import { env } from "../../../../../../lib/env";

export const createCheckoutSessionProcedure = protectedOrgProcedure
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
        message:
          "Billing is not configured. Please contact support to upgrade.",
      });
    }

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

    // Check if already on PRO
    if (organization.OrganizationSubscription?.plan === SubscriptionPlan.PRO) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Organization is already on the PRO plan",
      });
    }

    // Create Stripe checkout session
    const baseUrl = env.BETTER_AUTH_URL;
    const successUrl = `${baseUrl}/o/${organization.slug}/settings/org/billing?success=true`;
    const cancelUrl = `${baseUrl}/o/${organization.slug}/settings/org/billing?cancelled=true`;

    const session = await createCheckoutSession({
      organizationId: organization.id,
      organizationName: organization.name,
      customerId: organization.OrganizationSubscription?.stripeCustomerId,
      customerEmail: ctx.user.email,
      successUrl,
      cancelUrl,
    });

    return {
      checkoutUrl: session.url,
    };
  });
