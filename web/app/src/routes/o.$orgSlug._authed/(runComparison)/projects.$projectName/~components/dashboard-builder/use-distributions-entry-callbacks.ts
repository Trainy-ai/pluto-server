// Distributions-widget per-entry mutators, extracted from
// dashboard-builder.tsx (Boy Scout rule). Each callback targets an
// entry by INDEX inside config.entries[] — a single distributions
// widget can hold many bars/histogram entries; the renderer threads the
// entry index back through every change handler.

import { useCallback, type Dispatch, type SetStateAction } from "react";
import type {
  DashboardViewConfig,
  HistogramViewMode,
} from "../../~types/dashboard-types";
import * as configOps from "./use-dashboard-config";

interface UseDistributionsEntryCallbacksOptions {
  setConfig: Dispatch<SetStateAction<DashboardViewConfig>>;
  setHasChanges: (hasChanges: boolean) => void;
}

export function useDistributionsEntryCallbacks({
  setConfig,
  setHasChanges,
}: UseDistributionsEntryCallbacksOptions) {
  const updateViewMode = useCallback(
    (widgetId: string, index: number, mode: HistogramViewMode) => {
      setConfig((prev) =>
        configOps.updateWidgetDistributionsEntryViewMode(prev, widgetId, index, mode),
      );
      setHasChanges(true);
    },
    [setConfig, setHasChanges],
  );

  const updateDepthAxis = useCallback(
    (widgetId: string, index: number, axis: "step" | "run") => {
      setConfig((prev) =>
        configOps.updateWidgetDistributionsEntryDepthAxis(prev, widgetId, index, axis),
      );
      setHasChanges(true);
    },
    [setConfig, setHasChanges],
  );

  const updateBinRange = useCallback(
    (widgetId: string, index: number, range: { start: number; end: number }) => {
      setConfig((prev) =>
        configOps.updateWidgetDistributionsEntryBinRange(prev, widgetId, index, range),
      );
      setHasChanges(true);
    },
    [setConfig, setHasChanges],
  );

  const updateIgnoreOutliers = useCallback(
    (widgetId: string, index: number, next: boolean) => {
      setConfig((prev) =>
        configOps.updateWidgetDistributionsEntryIgnoreOutliers(prev, widgetId, index, next),
      );
      setHasChanges(true);
    },
    [setConfig, setHasChanges],
  );

  const updateStepsOnX = useCallback(
    (widgetId: string, index: number, next: boolean) => {
      setConfig((prev) =>
        configOps.updateWidgetDistributionsEntryStepsOnX(prev, widgetId, index, next),
      );
      setHasChanges(true);
    },
    [setConfig, setHasChanges],
  );

  return {
    updateViewMode,
    updateDepthAxis,
    updateBinRange,
    updateIgnoreOutliers,
    updateStepsOnX,
  };
}
