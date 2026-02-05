import Stripe from "stripe";
import { env } from "./env";

// Lazy-initialized Stripe client
let stripeClient: Stripe | null = null;

export function getStripe(): Stripe {
  if (!env.STRIPE_SECRET_KEY) {
    throw new Error("STRIPE_SECRET_KEY is not configured");
  }

  if (!stripeClient) {
    stripeClient = new Stripe(env.STRIPE_SECRET_KEY, {
      apiVersion: "2026-01-28.clover",
      typescript: true,
    });
  }

  return stripeClient;
}

export function isStripeConfigured(): boolean {
  return Boolean(env.STRIPE_SECRET_KEY && env.STRIPE_PRO_PRICE_ID);
}

// Plan configurations
export const FREE_PLAN_CONFIG = {
  seats: 2,
  dataUsageGB: 2,
  trainingHoursPerMonth: 50,
};

export const PRO_PLAN_CONFIG = {
  seats: 10,
  dataUsageGB: 10000, // 10 TB
  trainingHoursPerMonth: 999999, // Effectively unlimited
};

// Sentinel value for cancelled subscriptions (field is non-nullable in schema)
export const CANCELLED_SUBSCRIPTION_ID = "cancelled";

// Per-seat pricing: $250/seat/month
export const SEAT_PRICE_DOLLARS = 250;

interface CreateCheckoutSessionParams {
  organizationId: string;
  organizationName: string;
  customerId?: string;
  customerEmail: string;
  successUrl: string;
  cancelUrl: string;
  seatCount: number; // Number of seats to bill for
}

export async function createCheckoutSession(
  params: CreateCheckoutSessionParams
): Promise<Stripe.Checkout.Session> {
  const stripe = getStripe();

  if (!env.STRIPE_PRO_PRICE_ID) {
    throw new Error("STRIPE_PRO_PRICE_ID is not configured");
  }

  const sessionParams: Stripe.Checkout.SessionCreateParams = {
    mode: "subscription",
    payment_method_types: ["card"],
    line_items: [
      {
        price: env.STRIPE_PRO_PRICE_ID,
        quantity: params.seatCount, // Bill for current member count
      },
    ],
    success_url: params.successUrl,
    cancel_url: params.cancelUrl,
    // Allow users to enter promotion codes (e.g., YC cohort discounts)
    allow_promotion_codes: true,
    metadata: {
      organizationId: params.organizationId,
    },
    subscription_data: {
      metadata: {
        organizationId: params.organizationId,
      },
    },
  };

  // If we have an existing customer, use that
  if (params.customerId) {
    sessionParams.customer = params.customerId;
  } else {
    // Create or find customer by email
    sessionParams.customer_email = params.customerEmail;
  }

  return stripe.checkout.sessions.create(sessionParams);
}

/**
 * Sync Stripe subscription seat count with actual member count.
 * Used after member changes to ensure billing matches reality.
 */
export async function syncSubscriptionSeats(
  subscriptionId: string,
  memberCount: number
): Promise<void> {
  const stripe = getStripe();

  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  const item = subscription.items.data[0];

  if (!item) {
    console.error("No subscription item found for subscription:", subscriptionId);
    return;
  }

  // Only update if quantity differs
  if (item.quantity !== memberCount) {
    await stripe.subscriptionItems.update(item.id, {
      quantity: memberCount,
      proration_behavior: "create_prorations",
    });
  }
}

interface CreatePortalSessionParams {
  customerId: string;
  returnUrl: string;
}

export async function createPortalSession(
  params: CreatePortalSessionParams
): Promise<Stripe.BillingPortal.Session> {
  const stripe = getStripe();

  return stripe.billingPortal.sessions.create({
    customer: params.customerId,
    return_url: params.returnUrl,
  });
}

export async function getOrCreateStripeCustomer(
  email: string,
  organizationName: string,
  organizationId: string
): Promise<string> {
  const stripe = getStripe();

  // Check if customer already exists
  const existingCustomers = await stripe.customers.list({
    email,
    limit: 1,
  });

  if (existingCustomers.data.length > 0) {
    return existingCustomers.data[0].id;
  }

  // Create new customer
  const customer = await stripe.customers.create({
    email,
    name: organizationName,
    metadata: {
      organizationId,
    },
  });

  return customer.id;
}

export async function cancelSubscription(
  subscriptionId: string
): Promise<Stripe.Subscription> {
  const stripe = getStripe();

  return stripe.subscriptions.cancel(subscriptionId);
}

export function constructWebhookEvent(
  payload: string | Buffer,
  signature: string
): Stripe.Event {
  const stripe = getStripe();

  if (!env.STRIPE_WEBHOOK_SECRET) {
    throw new Error("STRIPE_WEBHOOK_SECRET is not configured");
  }

  return stripe.webhooks.constructEvent(
    payload,
    signature,
    env.STRIPE_WEBHOOK_SECRET
  );
}
