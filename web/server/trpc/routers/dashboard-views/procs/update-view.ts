import { z } from "zod";
import { protectedOrgProcedure } from "../../../../lib/trpc";
import { DashboardViewConfigSchema } from "../../../../lib/dashboard-types";
import { updateDashboardView } from "../../../../lib/dashboard-view-service";
import { dashboardViewId, throwDashboardServiceError } from "../service-errors";

export const updateViewProcedure = protectedOrgProcedure
  .input(
    z.object({
      viewId: z.coerce.string(),
      name: z.string().min(1).max(255).optional(),
      config: DashboardViewConfigSchema.optional(),
      isDefault: z.boolean().optional(),
      expectedUpdatedAt: z.string().datetime().optional(),
    }),
  )
  .mutation(async ({ ctx, input }) => {
    const {
      organizationId,
      viewId,
      name,
      config,
      isDefault,
      expectedUpdatedAt,
    } = input;

    let updatedView;
    try {
      updatedView = await updateDashboardView(ctx.prisma, {
        organizationId,
        viewId: dashboardViewId(viewId),
        actorId: ctx.user.id,
        actorRole: ctx.member.role,
        name,
        config,
        isDefault,
        expectedUpdatedAt: expectedUpdatedAt
          ? new Date(expectedUpdatedAt)
          : undefined,
        source: "web",
      });
    } catch (error) {
      throwDashboardServiceError(error);
    }

    return {
      id: updatedView.id.toString(),
      name: updatedView.name,
      isDefault: updatedView.isDefault,
      currentVersion: updatedView.currentVersion,
      config: DashboardViewConfigSchema.parse(updatedView.config),
      createdAt: updatedView.createdAt,
      updatedAt: updatedView.updatedAt,
      createdBy: updatedView.createdBy,
    };
  });
