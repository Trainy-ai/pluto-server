import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { OrganizationRole, Prisma } from "@prisma/client";
import { protectedOrgProcedure } from "../../../../lib/trpc";
import {
  DashboardViewConfigSchema,
  createEmptyDashboardConfig,
} from "../../../../lib/dashboard-types";

export const createViewProcedure = protectedOrgProcedure
  .input(
    z.object({
      projectName: z.string(),
      name: z.string().min(1).max(255),
      config: DashboardViewConfigSchema.optional(),
      isDefault: z.boolean().optional().default(false),
    })
  )
  .mutation(async ({ ctx, input }) => {
    const { organizationId, projectName, name, config, isDefault } = input;

    // Only admin/owner can set isDefault
    if (isDefault) {
      const isAdminOrOwner = ctx.member.role === OrganizationRole.OWNER || ctx.member.role === OrganizationRole.ADMIN;
      if (!isAdminOrOwner) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Only administrators can set a view as the default",
        });
      }
    }

    // Find the project
    const project = await ctx.prisma.projects.findUnique({
      where: {
        organizationId_name: {
          organizationId,
          name: projectName,
        },
      },
    });

    if (!project) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Project not found",
      });
    }

    // Check if a view with this name already exists
    const existingView = await ctx.prisma.dashboardView.findUnique({
      where: {
        organizationId_projectId_name: {
          organizationId,
          projectId: project.id,
          name,
        },
      },
    });

    if (existingView) {
      throw new TRPCError({
        code: "CONFLICT",
        message: "A dashboard view with this name already exists",
      });
    }

    // If this view is being set as default, unset other defaults
    if (isDefault) {
      await ctx.prisma.dashboardView.updateMany({
        where: {
          organizationId,
          projectId: project.id,
          isDefault: true,
        },
        data: {
          isDefault: false,
        },
      });
    }

    // Create the new dashboard view
    const view = await ctx.prisma.dashboardView.create({
      data: {
        name,
        organizationId,
        projectId: project.id,
        createdById: ctx.user.id,
        isDefault,
        config: (config ?? createEmptyDashboardConfig()) as unknown as Prisma.InputJsonValue,
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

    const viewWithRelations = view as typeof view & {
      createdBy: { id: string; name: string | null; image: string | null };
    };

    return {
      id: viewWithRelations.id.toString(),
      name: viewWithRelations.name,
      isDefault: viewWithRelations.isDefault,
      config: DashboardViewConfigSchema.parse(viewWithRelations.config),
      createdAt: viewWithRelations.createdAt,
      updatedAt: viewWithRelations.updatedAt,
      createdBy: viewWithRelations.createdBy,
    };
  });
