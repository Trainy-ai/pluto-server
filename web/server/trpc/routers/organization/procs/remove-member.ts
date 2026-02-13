import { OrganizationRole, SubscriptionPlan } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import {
  protectedOrgProcedure,
  protectedProcedure,
} from "../../../../lib/trpc";
import { z } from "zod";
import { syncSubscriptionSeats, isActiveStripeSubscription } from "../../../../lib/stripe";

export const removeMemberProcedure = protectedOrgProcedure
  .input(z.object({ memberId: z.string() }))
  .mutation(async ({ ctx, input }) => {
    // Check if user has permission to remove members
    const userMembership = await ctx.prisma.member.findFirst({
      where: {
        organizationId: input.organizationId,
        userId: ctx.user.id,
        role: {
          in: [OrganizationRole.OWNER, OrganizationRole.ADMIN],
        },
      },
    });

    if (!userMembership) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "You do not have permission to remove members",
      });
    }

    // Check if target member exists and is not the owner
    const targetMember = await ctx.prisma.member.findFirst({
      where: {
        id: input.memberId,
        organizationId: input.organizationId,
      },
    });

    if (!targetMember) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Member not found",
      });
    }

    if (targetMember.role === OrganizationRole.OWNER) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Cannot remove the organization owner",
      });
    }

    // If user is admin, they can't remove other admins
    if (
      userMembership.role === OrganizationRole.ADMIN &&
      targetMember.role === OrganizationRole.ADMIN
    ) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Admins cannot remove other admins",
      });
    }

    await ctx.prisma.member.delete({
      where: {
        id: input.memberId,
      },
    });

    // Update Stripe seat count if org is on PRO plan with active subscription
    const orgSub = await ctx.prisma.organizationSubscription.findUnique({
      where: { organizationId: input.organizationId },
    });

    if (
      orgSub?.plan === SubscriptionPlan.PRO &&
      orgSub.stripeSubscriptionId &&
      isActiveStripeSubscription(orgSub.stripeSubscriptionId)
    ) {
      const newMemberCount = await ctx.prisma.member.count({
        where: { organizationId: input.organizationId },
      });
      try {
        await syncSubscriptionSeats(orgSub.stripeSubscriptionId, newMemberCount);
        // Update local seat count
        await ctx.prisma.organizationSubscription.update({
          where: { organizationId: input.organizationId },
          data: { seats: newMemberCount },
        });
      } catch (error) {
        console.error("Failed to update Stripe seat count:", error);
        // Don't throw - member was already removed, billing update can be retried
      }
    }

    return { success: true };
  });
