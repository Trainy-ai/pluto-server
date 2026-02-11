import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedOrgProcedure } from "../../../../lib/trpc";

export const deleteViewProcedure = protectedOrgProcedure
  .input(
    z.object({
      viewId: z.string(),
    })
  )
  .mutation(async ({ ctx, input }) => {
    const { organizationId, viewId } = input;

    // First find the view
    const existingView = await ctx.prisma.runTableView.findFirst({
      where: {
        id: BigInt(viewId),
        organizationId,
      },
    });

    if (!existingView) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Run table view not found",
      });
    }

    // No creator/admin role checks — any org member can delete any view

    // Delete the view
    await ctx.prisma.runTableView.delete({
      where: {
        id: existingView.id,
      },
    });

    return { success: true };
  });
