import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedOrgProcedure } from "../../../../lib/trpc";
import {
  DashboardViewServiceError,
  listDashboardViewVersions,
} from "../../../../lib/dashboard-view-service";
import { dashboardViewId, throwDashboardServiceError } from "../service-errors";

export const listVersionsProcedure = protectedOrgProcedure
  .input(
    z.object({
      viewId: z.coerce.string(),
      limit: z.number().int().min(1).max(100).optional().default(50),
      beforeVersion: z.number().int().positive().optional(),
    }),
  )
  .query(async ({ ctx, input }) => {
    try {
      return await listDashboardViewVersions(ctx.prisma, {
        organizationId: input.organizationId,
        viewId: dashboardViewId(input.viewId),
        limit: input.limit,
        beforeVersion: input.beforeVersion,
      });
    } catch (error) {
      if (
        error instanceof DashboardViewServiceError &&
        error.code === "NOT_FOUND"
      ) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Dashboard view not found",
        });
      }
      throwDashboardServiceError(error);
    }
  });
