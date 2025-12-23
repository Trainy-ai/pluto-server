import { z } from "zod";
import { protectedProcedure } from "../../../../lib/trpc";
import { TRPCError } from "@trpc/server";
import { nanoid } from "nanoid";
import { OrganizationRole, SubscriptionPlan } from "@prisma/client";
import { getLimits } from "../../../../lib/limits";

// TODO: this only allows for free organizations for now
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
    const existingOrgs = await ctx.prisma.organization.findMany({
      where: {
        members: {
          some: { userId, role: OrganizationRole.OWNER },
        },
      },
      include: {
        OrganizationSubscription: true,
      },
    });

    const hasAFreeOrg = existingOrgs.some(
      (org) => org.OrganizationSubscription?.plan === SubscriptionPlan.FREE
    );

    console.log("hasAFreeOrg", hasAFreeOrg);

    if (hasAFreeOrg) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message:
          "You have reached the maximum number of free organizations. Please contact founders@mlop.ai for a pro account.",
      });
    }

    const stripeCustomerId = "TODO";
    const stripeSubscriptionId = "TODO";

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
          members: true,
        },
      });

      // Then create the subscription separately
      await ctx.prisma.organizationSubscription.create({
        data: {
          id: nanoid(),
          organizationId: newOrgId,
          plan: SubscriptionPlan.FREE,
          createdAt: new Date(),
          stripeCustomerId,
          stripeSubscriptionId,
          seats: 2,
          usageLimits: getLimits(SubscriptionPlan.FREE),
        },
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
        members: true,
        OrganizationSubscription: true, // Now include the subscription
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
