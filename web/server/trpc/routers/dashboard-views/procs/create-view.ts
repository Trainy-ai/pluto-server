import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedOrgProcedure } from "../../../../lib/trpc";
import {
  DashboardViewConfigSchema,
  createEmptyDashboardConfig,
} from "../../../../lib/dashboard-types";
import { createDashboardView } from "../../../../lib/dashboard-view-service";
import { throwDashboardServiceError } from "../service-errors";

export const createViewProcedure = protectedOrgProcedure
  .input(
    z.object({
      projectName: z.string(),
      name: z.string().min(1).max(255),
      config: DashboardViewConfigSchema.optional(),
      isDefault: z.boolean().optional().default(false),
    }),
  )
  .mutation(async ({ ctx, input }) => {
    const { organizationId, projectName, name, config, isDefault } = input;

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

    let view;
    try {
      view = await createDashboardView(ctx.prisma, {
        organizationId,
        projectId: project.id,
        actorId: ctx.user.id,
        actorRole: ctx.member.role,
        name,
        config: config ?? createEmptyDashboardConfig(),
        isDefault,
        source: "web",
      });
    } catch (error) {
      throwDashboardServiceError(error);
    }

    return {
      id: view.id.toString(),
      name: view.name,
      isDefault: view.isDefault,
      currentVersion: view.currentVersion,
      config: DashboardViewConfigSchema.parse(view.config),
      createdAt: view.createdAt,
      updatedAt: view.updatedAt,
      createdBy: view.createdBy,
    };
  });
