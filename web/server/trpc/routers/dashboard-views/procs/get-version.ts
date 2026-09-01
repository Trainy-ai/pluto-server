import { z } from "zod";
import { TRPCError } from "@trpc/server";
import {
  DashboardViewServiceError,
  getDashboardViewVersion,
} from "../../../../lib/dashboard-view-service";
import { protectedOrgProcedure } from "../../../../lib/trpc";
import { dashboardViewId, throwDashboardServiceError } from "../service-errors";

export const getVersionProcedure = protectedOrgProcedure
  .input(
    z.object({
      viewId: z.coerce.string(),
      version: z.number().int().positive(),
    }),
  )
  .query(async ({ ctx, input }) => {
    try {
      const snapshot = await getDashboardViewVersion(ctx.prisma, {
        organizationId: input.organizationId,
        viewId: dashboardViewId(input.viewId),
        version: input.version,
      });
      return snapshot;
    } catch (error) {
      if (
        error instanceof DashboardViewServiceError &&
        error.code === "NOT_FOUND" &&
        error.message === "Dashboard not found"
      ) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Dashboard view not found",
        });
      }
      throwDashboardServiceError(error);
    }
  });
