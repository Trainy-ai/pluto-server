import { OrganizationRole } from "@prisma/client";

import { InvitationStatus } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure } from "../../../../../../lib/trpc";
import { nanoid } from "nanoid";

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

    const memberLimit = organization?.members.length;
    const subscriptionLimit = organization?.OrganizationSubscription?.seats;

    if (memberLimit && subscriptionLimit && memberLimit >= subscriptionLimit) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message:
          "Organization is full. Please ask your administrator to upgrade your organization.",
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

    return result[0];
  });
