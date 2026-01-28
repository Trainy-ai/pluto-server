import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { OrganizationRole } from "@prisma/client";
import { protectedOrgProcedure } from "../../../../lib/trpc";
import { DashboardViewConfigSchema } from "../../../../lib/dashboard-types";

export const updateViewProcedure = protectedOrgProcedure
  .input(
    z.object({
      viewId: z.string(),
      name: z.string().min(1).max(255).optional(),
      config: DashboardViewConfigSchema.optional(),
      isDefault: z.boolean().optional(),
    })
  )
  .mutation(async ({ ctx, input }) => {
    const { organizationId, viewId, name, config, isDefault } = input;

    // Find the existing view
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
        message: "You do not have permission to modify this dashboard view",
      });
    }

    // Only admin/owner can set isDefault
    if (isDefault === true && !isAdminOrOwner) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Only administrators can set a view as the default",
      });
    }

    // If renaming, check for name conflicts
    if (name && name !== existingView.name) {
      const conflictingView = await ctx.prisma.dashboardView.findUnique({
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
          message: "A dashboard view with this name already exists",
        });
      }
    }

    // If setting as default, unset other defaults
    if (isDefault === true) {
      await ctx.prisma.dashboardView.updateMany({
        where: {
          organizationId,
          projectId: existingView.projectId,
          isDefault: true,
          id: { not: existingView.id },
        },
        data: {
          isDefault: false,
        },
      });
    }

    // Update the view
    const updatedView = await ctx.prisma.dashboardView.update({
      where: {
        id: existingView.id,
      },
      data: {
        ...(name !== undefined && { name }),
        ...(config !== undefined && { config }),
        ...(isDefault !== undefined && { isDefault }),
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
      isDefault: updatedView.isDefault,
      config: DashboardViewConfigSchema.parse(updatedView.config),
      createdAt: updatedView.createdAt,
      updatedAt: updatedView.updatedAt,
      createdBy: updatedView.createdBy,
    };
  });
