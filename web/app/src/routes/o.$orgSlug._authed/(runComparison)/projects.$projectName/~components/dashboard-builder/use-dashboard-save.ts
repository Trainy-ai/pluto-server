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
}

export function useDashboardSave({
  view,
  config,
  organizationId,
  projectName,
  clearDraft,
  onSaveSuccess,
}: UseDashboardSaveOptions) {
  const updateMutation = useUpdateDashboardView(organizationId, projectName);

  const handleSave = useCallback(() => {
    updateMutation.mutate(
      {
        organizationId,
        viewId: view.id,
        config: sanitizeConfig(config),
      },
      {
        onSuccess: () => {
          clearDraft();
          onSaveSuccess();
        },
        onError: (error) => {
          console.error("Dashboard save failed:", error);
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
  };
}
