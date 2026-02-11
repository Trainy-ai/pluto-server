import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedOrgProcedure } from "../../../../lib/trpc";
import {
  RunTableViewConfigSchema,
  createEmptyRunTableViewConfig,
} from "../../../../lib/run-table-view-types";

export const createViewProcedure = protectedOrgProcedure
  .input(
    z.object({
      projectName: z.string(),
      name: z.string().min(1).max(255),
      config: RunTableViewConfigSchema.optional(),
    })
  )
  .mutation(async ({ ctx, input }) => {
    const { organizationId, projectName, name, config } = input;

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
    const existingView = await ctx.prisma.runTableView.findUnique({
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
        message: "A run table view with this name already exists",
      });
    }

    // Create the new run table view
    const view = await ctx.prisma.runTableView.create({
      data: {
        name,
        organizationId,
        projectId: project.id,
        createdById: ctx.user.id,
        config: config ?? createEmptyRunTableViewConfig(),
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
      id: view.id.toString(),
      name: view.name,
      config: RunTableViewConfigSchema.parse(view.config),
      createdAt: view.createdAt,
      updatedAt: view.updatedAt,
      createdBy: view.createdBy,
    };
  });
