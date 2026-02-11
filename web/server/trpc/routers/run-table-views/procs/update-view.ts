import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedOrgProcedure } from "../../../../lib/trpc";
import { RunTableViewConfigSchema } from "../../../../lib/run-table-view-types";

export const updateViewProcedure = protectedOrgProcedure
  .input(
    z.object({
      viewId: z.string(),
      name: z.string().min(1).max(255).optional(),
      config: RunTableViewConfigSchema.optional(),
    })
  )
  .mutation(async ({ ctx, input }) => {
    const { organizationId, viewId, name, config } = input;

    // Find the existing view
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

    // If renaming, check for name conflicts
    if (name && name !== existingView.name) {
      const conflictingView = await ctx.prisma.runTableView.findUnique({
        where: {
          organizationId_projectId_name: {
            organizationId,
            projectId: existingView.projectId,
            name,
          },
        },
      });

      if (conflictingView) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "A run table view with this name already exists",
        });
      }
    }

    // Update the view
    const updatedView = await ctx.prisma.runTableView.update({
      where: {
        id: existingView.id,
      },
      data: {
        ...(name !== undefined && { name }),
        ...(config !== undefined && { config }),
      },
      include: {
        createdBy: {
          select: {
            id: true,
            name: true,
            image: true,
          },
        },
      },
    });

    return {
      id: updatedView.id.toString(),
      name: updatedView.name,
      config: RunTableViewConfigSchema.parse(updatedView.config),
      createdAt: updatedView.createdAt,
      updatedAt: updatedView.updatedAt,
      createdBy: updatedView.createdBy,
    };
  });
