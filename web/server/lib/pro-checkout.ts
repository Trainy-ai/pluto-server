import { TRPCError } from "@trpc/server";
import { SubscriptionPlan } from "@prisma/client";
import { prisma } from "./prisma";
import { createCheckoutSession, isStripeConfigured } from "./stripe";

interface StartProCheckoutParams {
  organizationId: string;
  /** Pre-filled on the checkout when the org has no Stripe customer yet. */
  customerEmail: string;
  /** Where Stripe sends the browser afterwards, given the org's slug. */
  returnUrls: (orgSlug: string) => { successUrl: string; cancelUrl: string };
}

/**
 * Opens a Stripe Checkout that upgrades an organization to PRO; the upgrade
 * itself is applied by routes/stripe-webhook.ts once checkout completes.
 * Callers authorize first: the org's own billing page requires OWNER/ADMIN,
 * the platform admin page requires a platform admin.
 */
export async function startProCheckout(
  params: StartProCheckoutParams,
): Promise<{ checkoutUrl: string | null }> {
  if (!isStripeConfigured()) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Billing is not configured. Please contact support to upgrade.",
    });
  }

  const organization = await prisma.organization.findUnique({
    where: { id: params.organizationId },
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

  if (organization.OrganizationSubscription?.plan === SubscriptionPlan.PRO) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Organization is already on the PRO plan",
    });
  }

  // Get current member count for seat-based billing
  const memberCount = await prisma.member.count({
    where: { organizationId: params.organizationId },
  });

  // Only use existing customer ID if it's a valid Stripe customer ID
  // (handles legacy orgs with placeholder values like "TODO" or empty strings)
  const existingCustomerId = organization.OrganizationSubscription?.stripeCustomerId;
  const validCustomerId = existingCustomerId?.startsWith("cus_") ? existingCustomerId : undefined;

  const session = await createCheckoutSession({
    organizationId: organization.id,
    organizationName: organization.name,
    customerId: validCustomerId,
    customerEmail: params.customerEmail,
    ...params.returnUrls(organization.slug),
    seatCount: memberCount,
  });

  return {
    checkoutUrl: session.url,
  };
}
