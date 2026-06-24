// LEGACY PARSE ONLY.
//
// Standalone histogram widgets (Widget.type === "histogram") are no
// longer created from the UI — they're rendered as `kind: "histogram"`
// entries inside a distributions widget. migrateDashboardConfig
// (use-dashboard-config.ts) converts any saved `"histogram"` widget
// to a single-entry distributions widget on read. This component is
// the render-time safety net for any in-flight `"histogram"` widget
// that hasn't been opened-and-resaved yet. Once every saved dashboard
// has rolled forward, this file + the "histogram" case in
// widget-renderer + the enum entry can all be deleted.

import { useMemo } from "react";
import type { HistogramWidgetConfig } from "../../~types/dashboard-types";
import type { SelectedRunWithColor } from "../../~hooks/use-selected-runs";
import { MultiHistogramView } from "../multi-group/histogram-view";
import { formatRunLabel } from "@/lib/format-run-label";
import { getDisplayIdForRun } from "../../~lib/metrics-utils";

interface HistogramWidgetProps {
  config: HistogramWidgetConfig;
  selectedRuns: Record<string, SelectedRunWithColor>;
  organizationId: string;
  projectName: string;
  /** Persists the Ignore-outliers toggle back into the widget config. */
  onIgnoreOutliersChange?: (next: boolean) => void;
}

export function HistogramWidget({
  config,
  selectedRuns,
  organizationId,
  projectName,
  onIgnoreOutliersChange,
}: HistogramWidgetProps) {
  const runs = useMemo(() => {
    return Object.entries(selectedRuns).map(([runId, { run, color }]) => ({
      runId,
      runName: formatRunLabel(run.name, getDisplayIdForRun(run)),
      color,
    }));
  }, [selectedRuns]);

  if (!config.metric) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        Select a histogram metric
      </div>
    );
  }

  if (runs.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <div className="text-center">
          <p>No runs selected</p>
          <p className="text-xs">Select runs from the list to view data</p>
        </div>
      </div>
    );
  }

  return (
    <MultiHistogramView
      logName={config.metric}
      tenantId={organizationId}
      projectName={projectName}
      runs={runs}
      mode={config.viewMode ?? "step"}
      hideToggle
      ignoreOutliers={config.ignoreOutliers ?? true}
      onIgnoreOutliersChange={onIgnoreOutliersChange}
      // Drop the default p-4 so the sticky footer sits flush against
      // the dashboard widget border, matching the {bars} chart-widget
      // (categorical view, no p-4). All Metrics keeps p-4 since the
      // outer DropdownRegion card has no internal padding.
      className="p-0"
    />
  );
}
