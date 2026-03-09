import type React from "react";
import { useCallback } from "react";
import { toast } from "sonner";
import { useUpdateDashboardView, type DashboardView } from "../../~queries/dashboard-views";
import type { DashboardViewConfig } from "../../~types/dashboard-types";
import { sanitizeConfig } from "./use-dashboard-config";

interface UseDashboardSaveOptions {
  view: DashboardView;
  config: DashboardViewConfig;
  organizationId: string;
  projectName: string;
  clearDraft: () => void;
  onSaveSuccess: () => void;
  /** Ref that holds the updatedAt timestamp captured when editing started */
  expectedUpdatedAtRef: React.RefObject<string | null>;
  /** Called when the server returns a CONFLICT error (stale dashboard) */
  onConflict?: () => void;
}

export function useDashboardSave({
  view,
  config,
  organizationId,
  projectName,
  clearDraft,
  onSaveSuccess,
  expectedUpdatedAtRef,
  onConflict,
}: UseDashboardSaveOptions) {
  const updateMutation = useUpdateDashboardView(organizationId, projectName);

  const handleSave = useCallback(() => {
    // Read the ref at call time so we always get the current value
    const expectedUpdatedAt = expectedUpdatedAtRef.current ?? undefined;
    updateMutation.mutate(
      {
        organizationId,
        viewId: view.id,
        config: sanitizeConfig(config),
        ...(expectedUpdatedAt && { expectedUpdatedAt }),
      },
      {
        onSuccess: () => {
          clearDraft();
          onSaveSuccess();
        },
        onError: (error) => {
          // If conflict detected, notify the caller instead of showing a generic error
          if (onConflict && error.data?.code === "CONFLICT") {
            onConflict();
            return;
          }
          console.error("Dashboard save failed:", error);
          toast.error("Failed to save dashboard", {
            description: error.message || "An unexpected error occurred",
          });
        },
      }
    );
  }, [updateMutation, organizationId, view.id, config, clearDraft, onSaveSuccess, expectedUpdatedAtRef, onConflict]);

  // Force save without concurrency check (override remote changes)
  const handleOverride = useCallback(() => {
    updateMutation.mutate(
      {
        organizationId,
        viewId: view.id,
        config: sanitizeConfig(config),
        // No expectedUpdatedAt → force override
      },
      {
        onSuccess: () => {
          clearDraft();
          onSaveSuccess();
          toast.success("Dashboard saved (overriding remote changes)");
        },
        onError: (error) => {
          console.error("Dashboard override save failed:", error);
          toast.error("Failed to save dashboard", {
            description: error.message || "An unexpected error occurred",
          });
        },
      }
    );
  }, [updateMutation, organizationId, view.id, config, clearDraft, onSaveSuccess]);

  return {
    isSaving: updateMutation.isPending,
    handleSave,
    handleOverride,
  };
}
