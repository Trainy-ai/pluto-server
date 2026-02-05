import { Hono } from "hono";
import { SubscriptionPlan } from "@prisma/client";
import { constructWebhookEvent, PRO_PLAN_CONFIG, FREE_PLAN_CONFIG, CANCELLED_SUBSCRIPTION_ID, isStripeConfigured, syncSubscriptionSeats } from "../lib/stripe";
import { prisma } from "../lib/prisma";
import { sendEmail } from "../lib/email";
import { env } from "../lib/env";
import type Stripe from "stripe";

const router = new Hono();

// Escape HTML to prevent XSS/HTML injection in email notifications
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// Helper to send admin notification emails for billing events
async function notifyAdminOfBillingEvent(
  subject: string,
  details: { organizationName: string; organizationId: string; customerEmail?: string; extra?: string }
) {
  if (!env.ADMIN_NOTIFICATION_EMAIL) {
    return;
  }

  const timestamp = new Date().toISOString();
  const safeOrgName = escapeHtml(details.organizationName);
  const safeOrgId = escapeHtml(details.organizationId);
  const safeEmail = details.customerEmail ? escapeHtml(details.customerEmail) : null;
  const safeExtra = details.extra ? escapeHtml(details.extra) : null;

  const html = `
    <h2>${escapeHtml(subject)}</h2>
    <ul>
      <li><strong>Organization:</strong> ${safeOrgName}</li>
      <li><strong>Organization ID:</strong> ${safeOrgId}</li>
      ${safeEmail ? `<li><strong>Customer Email:</strong> ${safeEmail}</li>` : ""}
      <li><strong>Time:</strong> ${timestamp}</li>
      ${safeExtra ? `<li><strong>Details:</strong> ${safeExtra}</li>` : ""}
    </ul>
  `;

  const text = `${subject}\n\nOrganization: ${details.organizationName}\nOrganization ID: ${details.organizationId}${details.customerEmail ? `\nCustomer Email: ${details.customerEmail}` : ""}\nTime: ${timestamp}${details.extra ? `\nDetails: ${details.extra}` : ""}`;

  await sendEmail({
    to: env.ADMIN_NOTIFICATION_EMAIL,
    subject: `[mlop] ${subject}`,
    html,
    text,
  });
}

router.post("/webhook", async (c) => {
  if (!isStripeConfigured()) {
    return c.json({ error: "Stripe is not configured" }, 500);
  }

  const signature = c.req.header("stripe-signature");
  if (!signature) {
    return c.json({ error: "Missing stripe-signature header" }, 400);
  }

  let event: Stripe.Event;

  try {
    // Get raw body for signature verification
    const rawBody = await c.req.text();
    event = constructWebhookEvent(rawBody, signature);
  } catch (err) {
    console.error("Webhook signature verification failed:", err);
    return c.json({ error: "Invalid signature" }, 400);
  }

  // Prevent test mode webhooks from modifying production data
  // This protects against staging (with test keys) accidentally upgrading prod subscriptions
  if (!event.livemode) {
    console.log(`Ignoring test mode webhook event: ${event.type}`);
    return c.json({ received: true });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        await handleCheckoutCompleted(session);
        break;
      }

      case "customer.subscription.updated": {
        const subscription = event.data.object as Stripe.Subscription;
        await handleSubscriptionUpdated(subscription);
        break;
      }

      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription;
        await handleSubscriptionDeleted(subscription);
        break;
      }

      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;
        await handlePaymentFailed(invoice);
        break;
      }

      default:
        console.log(`Unhandled event type: ${event.type}`);
    }

    return c.json({ received: true });
  } catch (err) {
    console.error(`Error handling webhook event ${event.type}:`, err);
    return c.json({ error: "Webhook handler failed" }, 500);
  }
});

async function handleCheckoutCompleted(session: Stripe.Checkout.Session) {
  const organizationId = session.metadata?.organizationId;
  if (!organizationId) {
    console.error("No organizationId in checkout session metadata");
    return;
  }

  const customerId = session.customer as string;
  const subscriptionId = session.subscription as string;

  // Get organization details for notification
  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
  });

  // Get current member count for initial seat count
  const memberCount = await prisma.member.count({
    where: { organizationId },
  });

  // Sync Stripe subscription if member count changed during checkout
  // (handles race condition where members were added/removed during payment)
  try {
    await syncSubscriptionSeats(subscriptionId, memberCount);
  } catch (error) {
    console.error("Failed to sync Stripe seat count:", error);
    // Continue - local DB update is still important
  }

  // Update organization subscription to PRO
  // Note: seats is the max allowed seats for the plan, not current member count
  // Stripe billing uses memberCount for per-seat charges
  await prisma.organizationSubscription.update({
    where: { organizationId },
    data: {
      plan: SubscriptionPlan.PRO,
      stripeCustomerId: customerId,
      stripeSubscriptionId: subscriptionId,
      seats: PRO_PLAN_CONFIG.seats,
      usageLimits: {
        dataUsageGB: PRO_PLAN_CONFIG.dataUsageGB,
        trainingHoursPerMonth: PRO_PLAN_CONFIG.trainingHoursPerMonth,
      },
    },
  });

  console.log(`Organization ${organizationId} upgraded to PRO plan (${memberCount} members, ${PRO_PLAN_CONFIG.seats} seats max)`);

  // Send admin notification
  await notifyAdminOfBillingEvent("New PRO Upgrade", {
    organizationName: organization?.name || "Unknown",
    organizationId,
    customerEmail: session.customer_email || undefined,
  });
}

async function handleSubscriptionUpdated(subscription: Stripe.Subscription) {
  // Find the organization - either from metadata or by subscription ID
  let targetOrgId = subscription.metadata?.organizationId;

  if (!targetOrgId) {
    const orgSub = await prisma.organizationSubscription.findFirst({
      where: { stripeSubscriptionId: subscription.id },
    });

    if (!orgSub) {
      console.error("Could not find organization for subscription:", subscription.id);
      return;
    }

    targetOrgId = orgSub.organizationId;
  }

  // Check if subscription is being cancelled
  if (subscription.status === "canceled" || subscription.cancel_at_period_end) {
    // Will be handled by subscription.deleted event or at period end
    console.log(`Subscription ${subscription.id} is being cancelled`);
    return;
  }

  // Update subscription if active
  if (subscription.status === "active") {
    await prisma.organizationSubscription.update({
      where: { organizationId: targetOrgId },
      data: {
        plan: SubscriptionPlan.PRO,
        stripeSubscriptionId: subscription.id,
        seats: PRO_PLAN_CONFIG.seats,
        usageLimits: {
          dataUsageGB: PRO_PLAN_CONFIG.dataUsageGB,
          trainingHoursPerMonth: PRO_PLAN_CONFIG.trainingHoursPerMonth,
        },
      },
    });
  }
}

async function handleSubscriptionDeleted(subscription: Stripe.Subscription) {
  // Find organization by subscription ID
  const orgSub = await prisma.organizationSubscription.findFirst({
    where: { stripeSubscriptionId: subscription.id },
    include: { organization: true },
  });

  if (!orgSub) {
    console.error("Could not find organization for deleted subscription:", subscription.id);
    return;
  }

  // Downgrade to FREE plan
  await prisma.organizationSubscription.update({
    where: { organizationId: orgSub.organizationId },
    data: {
      plan: SubscriptionPlan.FREE,
      stripeSubscriptionId: CANCELLED_SUBSCRIPTION_ID,
      seats: FREE_PLAN_CONFIG.seats,
      usageLimits: {
        dataUsageGB: FREE_PLAN_CONFIG.dataUsageGB,
        trainingHoursPerMonth: FREE_PLAN_CONFIG.trainingHoursPerMonth,
      },
    },
  });

  console.log(`Organization ${orgSub.organizationId} downgraded to FREE plan`);

  // Send admin notification
  await notifyAdminOfBillingEvent("Subscription Cancelled", {
    organizationName: orgSub.organization.name,
    organizationId: orgSub.organizationId,
    extra: "Downgraded to FREE plan",
  });
}

async function handlePaymentFailed(invoice: Stripe.Invoice) {
  // subscription can be string, Subscription object, or null
  const subscription = invoice.parent?.subscription_details?.subscription;
  const subscriptionId = typeof subscription === "string"
    ? subscription
    : subscription?.id;

  if (!subscriptionId) {
    return;
  }

  const orgSub = await prisma.organizationSubscription.findFirst({
    where: { stripeSubscriptionId: subscriptionId },
    include: { organization: true },
  });

  if (orgSub) {
    console.log(
      `Payment failed for organization ${orgSub.organizationId}, subscription ${subscriptionId}`
    );

    // Send admin notification
    await notifyAdminOfBillingEvent("Payment Failed", {
      organizationName: orgSub.organization.name,
      organizationId: orgSub.organizationId,
      extra: `Subscription: ${subscriptionId}`,
    });
  }
}

export default router;
