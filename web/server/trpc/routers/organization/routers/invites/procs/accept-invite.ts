import { OrganizationRole, SubscriptionPlan } from "@prisma/client";

import { InvitationStatus } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure } from "../../../../../../lib/trpc";
import { nanoid } from "nanoid";
import { syncSubscriptionSeats, isActiveStripeSubscription, FREE_PLAN_CONFIG, PRO_PLAN_CONFIG } from "../../../../../../lib/stripe";

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

    // Check member limit based on plan (not current billed seats)
    const currentMemberCount = organization?.members.length ?? 0;
    const plan = organization?.OrganizationSubscription?.plan;
    const maxSeats = plan === SubscriptionPlan.PRO
      ? PRO_PLAN_CONFIG.seats
      : FREE_PLAN_CONFIG.seats;

    if (currentMemberCount >= maxSeats) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message:
          plan === SubscriptionPlan.PRO
            ? "Organization has reached the maximum of 10 members."
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
        await syncSubscriptionSeats(orgSub.stripeSubscriptionId, newMemberCount);
        // Update local seat count
        await ctx.prisma.organizationSubscription.update({
          where: { organizationId: invitation.organizationId },
          data: { seats: newMemberCount },
        });
      } catch (error) {
        console.error("Failed to update Stripe seat count:", error);
        // Don't throw - member was already added, billing update can be retried
      }
    }

    return result[0];
  });
