import { OrganizationRole } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { protectedOrgProcedure } from "../../../../lib/trpc";

export const deleteOrgProcedure = protectedOrgProcedure.mutation(
  async ({ ctx, input }) => {
    const user = ctx.user;

    const userMembership = await ctx.prisma.member.findFirst({
      where: {
        organizationId: input.organizationId,
        userId: user.id,
      },
    });

    if (!userMembership) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "You do not have permission to delete this organization",
      });
    }

    if (userMembership.role !== OrganizationRole.OWNER) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Only organization owners can delete the organization",
      });
    }

    await ctx.prisma.organization.delete({
      where: {
        id: input.organizationId,
      },
    });

    // TODO: Delete all the data from clickhouse and all the images

    return { success: true };
  }
);
