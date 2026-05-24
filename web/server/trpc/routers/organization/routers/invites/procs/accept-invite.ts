import { OrganizationRole, SubscriptionPlan } from "@prisma/client";

import { InvitationStatus } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure } from "../../../../../../lib/trpc";
import { nanoid } from "nanoid";
import { syncSubscriptionSeats, isActiveStripeSubscription, FREE_PLAN_CONFIG } from "../../../../../../lib/stripe";

export const acceptInviteProcedure = protectedProcedure
  .input(z.object({ invitationId: z.string() }))
  .mutation(async ({ ctx, input }) => {
    const invitation = await ctx.prisma.invitation.findFirst({
      where: {
        id: input.invitationId,
        email: ctx.user.email,
        status: InvitationStatus.PENDING,
      },
    });

    if (!invitation || invitation.expiresAt < new Date()) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Invalid or expired invitation",
      });
    }

    // Check for the usage of the organization
    const organization = await ctx.prisma.organization.findUnique({
      where: { id: invitation.organizationId },
      select: {
        members: true,
        OrganizationSubscription: true,
      },
    });

    // Plan cap lives on the subscription row (set at plan-change time). Read
    // it directly so per-org overrides are respected; fall back to the FREE
    // default only when no subscription record exists.
    const currentMemberCount = organization?.members.length ?? 0;
    const plan = organization?.OrganizationSubscription?.plan;
    const dbMaxMembers = organization?.OrganizationSubscription?.maxMembers;
    const maxMembers = Number.isFinite(dbMaxMembers)
      ? (dbMaxMembers as number)
      : FREE_PLAN_CONFIG.maxMembers;

    if (currentMemberCount >= maxMembers) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message:
          plan === SubscriptionPlan.PRO
            ? `Organization has reached the maximum of ${maxMembers} members.`
            : "Organization is full. Please ask your administrator to upgrade your organization.",
      });
    }

    // Create member and update invitation in transaction
    const result = await ctx.prisma.$transaction([
      ctx.prisma.member.create({
        data: {
          id: nanoid(),
          organizationId: invitation.organizationId,
          userId: ctx.user.id,
          role: invitation.role || OrganizationRole.MEMBER,
          createdAt: new Date(),
        },
      }),
      ctx.prisma.invitation.update({
        where: { id: invitation.id },
        data: { status: InvitationStatus.ACCEPTED },
      }),
    ]);

    // Update Stripe seat count if org is on PRO plan with active subscription
    const orgSub = organization?.OrganizationSubscription;
    if (
      orgSub?.plan === SubscriptionPlan.PRO &&
      orgSub.stripeSubscriptionId &&
      isActiveStripeSubscription(orgSub.stripeSubscriptionId)
    ) {
      const newMemberCount = await ctx.prisma.member.count({
        where: { organizationId: invitation.organizationId },
      });
      try {
        // Stripe billing quantity tracks live member count. The local
        // `maxMembers` column is the plan cap and must NOT be overwritten here.
        await syncSubscriptionSeats(orgSub.stripeSubscriptionId, newMemberCount);
      } catch (error) {
        console.error("Failed to update Stripe seat count:", error);
        // Don't throw - member was already added, billing update can be retried
      }
    }

    return result[0];
  });
