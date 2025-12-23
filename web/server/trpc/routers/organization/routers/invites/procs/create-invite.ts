import { InvitationStatus, OrganizationRole } from "@prisma/client";
import { nanoid } from "nanoid";
import { z } from "zod";
import { protectedOrgProcedure } from "../../../../../../lib/trpc";
import { TRPCError } from "@trpc/server";

export const createInviteProcedure = protectedOrgProcedure
  .input(
    z.object({
      organizationId: z.string(),
      email: z.string().email(),
      role: z.nativeEnum(OrganizationRole),
    })
  )
  .mutation(async ({ ctx, input }) => {
    const userEmail = ctx.user.email;

    if (userEmail.toLowerCase() === input.email.toLowerCase()) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "You cannot invite yourself to the organization",
      });
    }

    // Run both database checks in parallel
    const [existingInvitation, userMembership] = await Promise.all([
      // Check if invitation already exists
      ctx.prisma.invitation.findFirst({
        where: {
          organizationId: input.organizationId,
          email: input.email,
          status: InvitationStatus.PENDING,
        },
      }),

      // Check users membership in the organization
      ctx.prisma.member.findFirst({
        where: {
          organizationId: input.organizationId,
          userId: ctx.user.id,
        },
      }),
    ]);

    if (existingInvitation) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "An invitation for this email already exists",
      });
    }

    if (userMembership?.role === OrganizationRole.MEMBER) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "You are not allowed to invite members to this organization",
      });
    }

    const invitation = await ctx.prisma.invitation.create({
      data: {
        id: nanoid(),
        organizationId: input.organizationId,
        email: input.email,
        role: input.role,
        status: InvitationStatus.PENDING,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
        inviterId: ctx.user.id,
      },
    });

    // Mock email sending, TODO: Implement actual email sending
    console.log(`Mock: Sending invitation email to ${input.email}`);

    return invitation;
  });
