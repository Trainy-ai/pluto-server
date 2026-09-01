import { TRPCError } from "@trpc/server";
import { DashboardViewServiceError } from "../../../lib/dashboard-view-service";

export function dashboardViewId(value: string): bigint {
  try {
    return BigInt(value);
  } catch {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Dashboard view not found",
    });
  }
}

export function throwDashboardServiceError(error: unknown): never {
  if (!(error instanceof DashboardViewServiceError)) {
    throw error;
  }

  switch (error.code) {
    case "NOT_FOUND":
      throw new TRPCError({ code: "NOT_FOUND", message: error.message });
    case "FORBIDDEN":
    case "DEFAULT_FORBIDDEN":
      throw new TRPCError({ code: "FORBIDDEN", message: error.message });
    case "CONFLICT":
    case "NAME_CONFLICT":
      throw new TRPCError({ code: "CONFLICT", message: error.message });
    case "INVALID_CONFIG":
      throw new TRPCError({
        code: "UNPROCESSABLE_CONTENT",
        message: error.message,
      });
    case "CURRENT_VERSION":
      throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
  }
}
