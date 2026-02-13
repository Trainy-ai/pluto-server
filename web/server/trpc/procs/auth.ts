import { limitsSchema } from "../../lib/limits";
import { publicProcedure } from "../../lib/trpc";
import { EDU_SUBSCRIPTION_ID } from "../../lib/stripe";

export const enhancedAuthProcedure = publicProcedure.query(async ({ ctx }) => {
  // Get session from the context
  const session = ctx.session;

  // If no session, return null
  if (!session) {
    return null;
  }

  // Get all organizations associated with the user
  const allOrgs = await ctx.prisma.organization.findMany({
    where: {
      members: {
        some: { userId: session.user.id },
      },
    },
    include: {
      OrganizationSubscription: {
        select: {
          plan: true,
          seats: true,
          usageLimits: true,
        },
      },
    },
  });

  // Get the active organization ID within the session
  const activeOrgId = session.session.activeOrganizationId;

  if (!activeOrgId) {
    return {
      ...session,
      activeOrganization: null,
      activeOrganizationSubscription: null,
      allOrgs,
    };
  }

  // Get the active organization from the database
  let activeOrganization = await ctx.prisma.organization.findUnique({
    where: { id: activeOrgId },
    include: {
      OrganizationSubscription: {
        select: {
          plan: true,
          seats: true,
          usageLimits: true,
          stripeSubscriptionId: true,
        },
      },
    },
  });

  const membership = await ctx.prisma.member.findFirst({
    where: {
      organizationId: activeOrgId,
      userId: session.user.id,
    },
  });

  // Try and parse the active organization's subscription
  const activeOrganizationSubscription =
    activeOrganization?.OrganizationSubscription
      ? {
          plan: activeOrganization.OrganizationSubscription.plan,
          seats: activeOrganization.OrganizationSubscription.seats,
          usageLimits: limitsSchema.parse(
            activeOrganization.OrganizationSubscription.usageLimits
          ),
          isEducationPlan:
            activeOrganization.OrganizationSubscription.stripeSubscriptionId ===
            EDU_SUBSCRIPTION_ID,
        }
      : null;

  if (!activeOrganization || !activeOrganizationSubscription || !membership) {
    return {
      ...session,
      activeOrganization: null,
      activeOrganizationSubscription: null,
      allOrgs,
    };
  }

  const activeOrganizationWithSubscription = {
    ...activeOrganization,
    OrganizationSubscription: activeOrganizationSubscription,
    membership,
  };

  return {
    ...session,
    activeOrganization: activeOrganizationWithSubscription,
    allOrgs,
  };
});
