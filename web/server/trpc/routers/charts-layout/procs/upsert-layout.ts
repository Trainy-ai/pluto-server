import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { Prisma } from "@prisma/client";
import { protectedOrgProcedure } from "../../../../lib/trpc";
import { ChartsLayoutConfigSchema } from "../../../../lib/charts-layout-types";

/**
 * Create or update the shared layout overlay for a project's default Charts
 * view. The overlay is shared across the whole project, so any organization
 * member may save it (membership is already enforced by protectedOrgProcedure).
 */
export const upsertLayoutProcedure = protectedOrgProcedure
  .input(
    z.object({
      projectName: z.string(),
      config: ChartsLayoutConfigSchema,
    })
  )
  .mutation(async ({ ctx, input }) => {
    const { organizationId, projectName, config } = input;

    const project = await ctx.prisma.projects.findUnique({
      where: {
        organizationId_name: {
          organizationId,
          name: projectName,
        },
      },
      select: { id: true },
    });

    if (!project) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Project not found",
      });
    }

    const jsonConfig = config as unknown as Prisma.InputJsonValue;

    const layout = await ctx.prisma.chartsLayout.upsert({
      where: {
        organizationId_projectId: {
          organizationId,
          projectId: project.id,
        },
      },
      create: {
        organizationId,
        projectId: project.id,
        updatedById: ctx.user.id,
        config: jsonConfig,
      },
      update: {
        updatedById: ctx.user.id,
        config: jsonConfig,
      },
    });

    return {
      config: ChartsLayoutConfigSchema.parse(layout.config),
      updatedAt: layout.updatedAt,
    };
  });
