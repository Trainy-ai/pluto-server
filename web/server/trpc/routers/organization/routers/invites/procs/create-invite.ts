import { InvitationStatus, OrganizationRole } from "@prisma/client";
import { nanoid } from "nanoid";
import { z } from "zod";
import { protectedOrgProcedure } from "../../../../../../lib/trpc";
import { TRPCError } from "@trpc/server";
import { sendEmail } from "../../../../../../lib/email";
import { generateInvitationEmail } from "../../../../../../lib/email-templates/invitation";

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

    // Get organization name for the email
    const organization = await ctx.prisma.organization.findUnique({
      where: { id: input.organizationId },
      select: { name: true },
    });

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

    // Send invitation email (non-blocking - failures are logged but don't fail the invitation)
    const emailData = generateInvitationEmail({
      inviterName: ctx.user.name || "A team member",
      inviterEmail: ctx.user.email,
      organizationName: organization?.name || "the organization",
      inviteeEmail: input.email,
      role: input.role,
      expiresAt: invitation.expiresAt,
    });

    const emailSent = await sendEmail({
      to: input.email,
      subject: emailData.subject,
      html: emailData.html,
      text: emailData.text,
    });

    if (!emailSent) {
      console.warn(`Failed to send invitation email to ${input.email}`);
    }

    return invitation;
  });
