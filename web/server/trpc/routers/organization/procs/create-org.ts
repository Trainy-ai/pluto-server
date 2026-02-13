import { z } from "zod";
import { protectedProcedure } from "../../../../lib/trpc";
import { TRPCError } from "@trpc/server";
import { nanoid } from "nanoid";
import { OrganizationRole, SubscriptionPlan } from "@prisma/client";
import { getLimits } from "../../../../lib/limits";
import { isEduEmail } from "../../../../lib/edu";
import { EDU_SUBSCRIPTION_ID, PRO_PLAN_CONFIG } from "../../../../lib/stripe";

export const createOrgProcedure = protectedProcedure
  .input(
    z.object({
      name: z.string().min(2).max(50),
      slug: z.string().min(2).max(50),
    })
  )
  .mutation(async ({ ctx, input }) => {
    // Check if organization with same slug already exists
    const existingOrganization = await ctx.prisma.organization.findFirst({
      where: {
        slug: input.slug,
      },
    });

    if (existingOrganization) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Organization with same slug already exists",
      });
    }

    const userId = ctx.user.id;
    const userEmail = ctx.user.email;
    const isEdu = ctx.user.emailVerified && isEduEmail(userEmail);

    const existingOrgs = await ctx.prisma.organization.findMany({
      where: {
        members: {
          some: { userId, role: OrganizationRole.OWNER },
        },
      },
      include: {
        // eslint-disable-next-line @mlop/no-unbounded-prisma-include -- 1:1 relation
        OrganizationSubscription: true,
      },
    });

    const hasAFreeOrg = existingOrgs.some(
      (org) => org.OrganizationSubscription?.plan === SubscriptionPlan.FREE
    );

    const hasAnEduProOrg = existingOrgs.some(
      (org) =>
        org.OrganizationSubscription?.plan === SubscriptionPlan.PRO &&
        org.OrganizationSubscription?.stripeSubscriptionId === EDU_SUBSCRIPTION_ID
    );

    if (hasAFreeOrg || hasAnEduProOrg) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message:
          "You have reached the maximum number of free organizations. Please contact founders@trainy.ai for a pro account.",
      });
    }

    // .edu email users get PRO for free; everyone else starts on FREE
    const plan = isEdu ? SubscriptionPlan.PRO : SubscriptionPlan.FREE;
    const stripeCustomerId = "";
    const stripeSubscriptionId = isEdu ? EDU_SUBSCRIPTION_ID : "";
    const seats = isEdu ? PRO_PLAN_CONFIG.seats : 2;

    // 1. Create the Organization first
    const newOrgId = nanoid();
    try {
      // Create the organization first
      await ctx.prisma.organization.create({
        data: {
          id: newOrgId,
          name: input.name,
          slug: input.slug,
          createdAt: new Date(),
          members: {
            create: {
              id: nanoid(),
              userId: ctx.user.id,
              role: OrganizationRole.OWNER,
              createdAt: new Date(),
            },
          },
        },
        include: {
          // eslint-disable-next-line @mlop/no-unbounded-prisma-include -- Newly created org, only 1 member
          members: true,
        },
      });

      // Then create the subscription separately
      await ctx.prisma.organizationSubscription.create({
        data: {
          id: nanoid(),
          organizationId: newOrgId,
          plan,
          createdAt: new Date(),
          stripeCustomerId,
          stripeSubscriptionId,
          seats,
          usageLimits: getLimits(plan),
        },
      });

      // Mark user as having finished onboarding after creating their first org
      await ctx.prisma.user.update({
        where: { id: ctx.user.id },
        data: { finishedOnboarding: true },
      });
    } catch (error) {
      console.error(error);
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Failed to create organization",
      });
    }

    // 3. Fetch the complete organization data including the subscription to return
    const finalOrganization = await ctx.prisma.organization.findUnique({
      where: { id: newOrgId },
      include: {
        // eslint-disable-next-line @mlop/no-unbounded-prisma-include -- Newly created org, only 1 member
        members: true,
        // eslint-disable-next-line @mlop/no-unbounded-prisma-include -- 1:1 relation
        OrganizationSubscription: true,
      },
    });

    if (!finalOrganization) {
      // This should not happen if the creates succeeded, but good practice to check
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Failed to retrieve created organization details",
      });
    }

    return finalOrganization;
  });
