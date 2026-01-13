import { OrganizationRole } from "@prisma/client";
import { z } from "zod";
import { protectedOrgProcedure } from "../../../../../../lib/trpc";
import { TRPCError } from "@trpc/server";

export const deleteInviteProcedure = protectedOrgProcedure
  .input(
    z.object({
      organizationId: z.string(),
      invitationId: z.string(),
    })
  )
  .mutation(async ({ ctx, input }) => {
    // Check user's membership role in the organization
    const userMembership = await ctx.prisma.member.findFirst({
      where: {
        organizationId: input.organizationId,
        userId: ctx.user.id,
      },
    });

    if (!userMembership) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "You are not a member of this organization",
      });
    }

    if (userMembership.role === OrganizationRole.MEMBER) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "You do not have permission to delete invitations",
      });
    }

    // Find the invitation
    const invitation = await ctx.prisma.invitation.findFirst({
      where: {
        id: input.invitationId,
        organizationId: input.organizationId,
      },
    });

    if (!invitation) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Invitation not found",
      });
    }

    // Delete the invitation
    await ctx.prisma.invitation.delete({
      where: {
        id: input.invitationId,
      },
    });

    return { success: true };
  });
