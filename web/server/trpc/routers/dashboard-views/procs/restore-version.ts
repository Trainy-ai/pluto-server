import { z } from "zod";
import { DashboardViewConfigSchema } from "../../../../lib/dashboard-types";
import { restoreDashboardViewVersion } from "../../../../lib/dashboard-view-service";
import { protectedOrgProcedure } from "../../../../lib/trpc";
import { dashboardViewId, throwDashboardServiceError } from "../service-errors";

export const restoreVersionProcedure = protectedOrgProcedure
  .input(
    z.object({
      viewId: z.coerce.string(),
      version: z.number().int().positive(),
      expectedUpdatedAt: z.string().datetime(),
    }),
  )
  .mutation(async ({ ctx, input }) => {
    let restored;
    try {
      restored = await restoreDashboardViewVersion(ctx.prisma, {
        organizationId: input.organizationId,
        viewId: dashboardViewId(input.viewId),
        version: input.version,
        actorId: ctx.user.id,
        actorRole: ctx.member.role,
        expectedUpdatedAt: new Date(input.expectedUpdatedAt),
      });
    } catch (error) {
      throwDashboardServiceError(error);
    }

    return {
      id: restored.id.toString(),
      name: restored.name,
      isDefault: restored.isDefault,
      currentVersion: restored.currentVersion,
      config: DashboardViewConfigSchema.parse(restored.config),
      createdAt: restored.createdAt,
      updatedAt: restored.updatedAt,
      createdBy: restored.createdBy,
      restoredFromVersion: input.version,
    };
  });
