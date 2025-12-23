import { OrganizationRole } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { protectedOrgProcedure } from "../../../../lib/trpc";
import { z } from "zod";

export const updateMemberRoleProcedure = protectedOrgProcedure
  .input(
    z.object({
      memberId: z.string(),
      role: z.nativeEnum(OrganizationRole),
    })
  )
  .mutation(async ({ ctx, input }) => {
    // Check if user has permission to update roles
    const userMembership = await ctx.prisma.member.findFirst({
      where: {
        organizationId: input.organizationId,
        userId: ctx.user.id,
        role: OrganizationRole.OWNER,
      },
    });

    if (!userMembership) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Only organization owners can update member roles",
      });
    }

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
        message: "Cannot change the role of the organization owner",
      });
    }

    const updatedMember = await ctx.prisma.member.update({
      where: {
        id: input.memberId,
      },
      data: {
        role: input.role,
      },
    });

    return updatedMember;
  });
