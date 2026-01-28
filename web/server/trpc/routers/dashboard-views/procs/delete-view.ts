import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { OrganizationRole } from "@prisma/client";
import { protectedOrgProcedure } from "../../../../lib/trpc";

export const deleteViewProcedure = protectedOrgProcedure
  .input(
    z.object({
      viewId: z.string(),
    })
  )
  .mutation(async ({ ctx, input }) => {
    const { organizationId, viewId } = input;

    // First find the view to check authorization
    const existingView = await ctx.prisma.dashboardView.findFirst({
      where: {
        id: BigInt(viewId),
        organizationId,
      },
    });

    if (!existingView) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Dashboard view not found",
      });
    }

    // Check authorization: user must be creator or admin/owner
    const isCreator = existingView.createdById === ctx.user.id;
    const isAdminOrOwner = ctx.member.role === OrganizationRole.OWNER || ctx.member.role === OrganizationRole.ADMIN;

    if (!isCreator && !isAdminOrOwner) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "You do not have permission to delete this dashboard view",
      });
    }

    // Delete the view
    await ctx.prisma.dashboardView.delete({
      where: {
        id: existingView.id,
      },
    });

    return { success: true };
  });
