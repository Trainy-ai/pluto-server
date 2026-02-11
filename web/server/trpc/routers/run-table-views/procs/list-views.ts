import { z } from "zod";
import { protectedOrgProcedure } from "../../../../lib/trpc";
import { RunTableViewConfigSchema } from "../../../../lib/run-table-view-types";

export const listViewsProcedure = protectedOrgProcedure
  .input(
    z.object({
      projectName: z.string(),
    })
  )
  .query(async ({ ctx, input }) => {
    const { organizationId, projectName } = input;

    // First, find the project
    const project = await ctx.prisma.projects.findUnique({
      where: {
        organizationId_name: {
          organizationId,
          name: projectName,
        },
      },
    });

    if (!project) {
      return { views: [] };
    }

    // Fetch all run table views for this project
    const views = await ctx.prisma.runTableView.findMany({
      where: {
        organizationId,
        projectId: project.id,
      },
      orderBy: [
        { updatedAt: "desc" },
      ],
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
      views: views.map((view) => ({
        id: view.id.toString(),
        name: view.name,
        config: RunTableViewConfigSchema.parse(view.config),
        createdAt: view.createdAt,
        updatedAt: view.updatedAt,
        createdBy: view.createdBy,
      })),
    };
  });
