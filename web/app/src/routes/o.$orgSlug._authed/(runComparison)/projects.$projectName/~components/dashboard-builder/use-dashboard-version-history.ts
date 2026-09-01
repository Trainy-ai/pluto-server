import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  type DashboardView,
  type GetDashboardVersionResponse,
  type RestoreDashboardVersionResponse,
  useDashboardVersion,
  useRestoreDashboardVersion,
} from "../../~queries/dashboard-views";

export function useDashboardVersionHistory({
  view,
  organizationId,
  projectName,
  isEditing,
  hasChanges,
  onDiscardEditing,
  onPreviewLoaded,
  onReturnToCurrent,
  onRestoreSuccess,
}: UseDashboardVersionHistoryOptions) {
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [previewVersion, setPreviewVersion] = useState<number | null>(null);
  const [currentVersion, setCurrentVersion] = useState(view.currentVersion);
  const restoreInFlightRef = useRef(false);
  const previewQuery = useDashboardVersion(
    organizationId,
    view.id,
    previewVersion,
  );
  const restoreMutation = useRestoreDashboardVersion(
    organizationId,
    projectName,
    view.id,
  );

  useEffect(() => {
    setPreviewVersion(null);
    setIsHistoryOpen(false);
  }, [view.id]);

  useEffect(() => {
    setCurrentVersion(view.currentVersion);
  }, [view.currentVersion, view.id]);

  useEffect(() => {
    if (!previewQuery.data || previewQuery.data.version !== previewVersion) {
      return;
    }
    onPreviewLoaded(previewQuery.data.config);
  }, [onPreviewLoaded, previewQuery.data, previewVersion]);

  const returnToCurrent = useCallback(() => {
    setPreviewVersion(null);
    onReturnToCurrent();
  }, [onReturnToCurrent]);

  const selectVersion = useCallback(
    (version: number) => {
      if (version === currentVersion) {
        if (previewVersion !== null) {
          returnToCurrent();
        }
        setIsHistoryOpen(false);
        return;
      }

      if (
        isEditing &&
        hasChanges &&
        !window.confirm(
          "Discard your unsaved changes and preview this dashboard version?",
        )
      ) {
        return;
      }

      if (isEditing) {
        onDiscardEditing();
      }
      setPreviewVersion(version);
      setIsHistoryOpen(false);
    },
    [
      hasChanges,
      isEditing,
      onDiscardEditing,
      previewVersion,
      returnToCurrent,
      currentVersion,
    ],
  );

  const restoreVersion = useCallback(() => {
    if (previewVersion === null || restoreInFlightRef.current) {
      return;
    }
    restoreInFlightRef.current = true;

    restoreMutation.mutate(
      {
        organizationId,
        viewId: view.id,
        version: previewVersion,
        expectedUpdatedAt: new Date(view.updatedAt).toISOString(),
      },
      {
        onSuccess: (restored) => {
          setCurrentVersion(restored.currentVersion);
          onRestoreSuccess(restored);
          setPreviewVersion(null);
          setIsHistoryOpen(false);
          toast.success(
            `Restored v${previewVersion} as v${restored.currentVersion}`,
          );
        },
        onError: (error) => {
          toast.error("Couldn’t restore dashboard version", {
            description:
              error.message ||
              "The dashboard may have changed. Refresh history and try again.",
          });
        },
        onSettled: () => {
          restoreInFlightRef.current = false;
        },
      },
    );
  }, [
    onRestoreSuccess,
    organizationId,
    previewVersion,
    restoreMutation,
    view.id,
    view.updatedAt,
  ]);

  return {
    isHistoryOpen,
    setIsHistoryOpen,
    previewVersion,
    currentVersion,
    previewQuery,
    restoreMutation,
    returnToCurrent,
    selectVersion,
    restoreVersion,
  };
}

interface UseDashboardVersionHistoryOptions {
  view: DashboardView;
  organizationId: string;
  projectName: string;
  isEditing: boolean;
  hasChanges: boolean;
  onDiscardEditing: () => void;
  onPreviewLoaded: (config: GetDashboardVersionResponse["config"]) => void;
  onReturnToCurrent: () => void;
  onRestoreSuccess: (restored: RestoreDashboardVersionResponse) => void;
}
