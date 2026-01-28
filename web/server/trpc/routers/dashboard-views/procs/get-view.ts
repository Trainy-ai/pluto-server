import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedOrgProcedure } from "../../../../lib/trpc";
import { DashboardViewConfigSchema } from "../../../../lib/dashboard-types";

export const getViewProcedure = protectedOrgProcedure
  .input(
    z.object({
      viewId: z.string(),
    })
  )
  .query(async ({ ctx, input }) => {
    const { organizationId, viewId } = input;

    const view = await ctx.prisma.dashboardView.findFirst({
      where: {
        id: BigInt(viewId),
        organizationId,
      },
      include: {
        createdBy: {
          select: {
            id: true,
            name: true,
            image: true,
          },
        },
        project: {
          select: {
            name: true,
          },
        },
      },
    });

    if (!view) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Dashboard view not found",
      });
    }

    return {
      id: view.id.toString(),
      name: view.name,
      isDefault: view.isDefault,
      config: DashboardViewConfigSchema.parse(view.config),
      createdAt: view.createdAt,
      updatedAt: view.updatedAt,
      createdBy: view.createdBy,
      projectName: view.project.name,
    };
  });
