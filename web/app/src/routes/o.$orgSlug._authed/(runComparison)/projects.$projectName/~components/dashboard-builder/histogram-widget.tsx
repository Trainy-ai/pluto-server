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
import { filterRunsByLog } from "@/lib/filter-runs-by-log";
import { useRunIdsByLogName } from "../../~queries/file-log-names";

interface HistogramWidgetProps {
  config: HistogramWidgetConfig;
  selectedRuns: Record<string, SelectedRunWithColor>;
  organizationId: string;
  projectName: string;
  /** Persists the Ignore-outliers toggle back into the widget config. */
  onIgnoreOutliersChange?: (next: boolean) => void;
}

/** Stable empty list: a fresh [] each render would churn the query key. */
const EMPTY_LOG_NAMES: string[] = [];

export function HistogramWidget({
  config,
  selectedRuns,
  organizationId,
  projectName,
  onIgnoreOutliersChange,
}: HistogramWidgetProps) {
  const allRuns = useMemo(() => {
    return Object.entries(selectedRuns).map(([runId, { run, color }]) => ({
      runId,
      runName: formatRunLabel(run.name, getDisplayIdForRun(run)),
      color,
    }));
  }, [selectedRuns]);

  // Narrow to the runs that logged this histogram — histogramBatch caps
  // runIds at 200, and a widget configured with one metric shouldn't send
  // every selected run to find out which ones have it.
  const logNames = useMemo(
    () => (config.metric ? [config.metric] : EMPTY_LOG_NAMES),
    [config.metric],
  );
  const selectedRunIds = useMemo(() => Object.keys(selectedRuns), [selectedRuns]);
  const { data: runIdsByLog } = useRunIdsByLogName(
    organizationId,
    projectName,
    logNames,
    selectedRunIds,
  );
  const runs = useMemo(
    () =>
      config.metric
        ? filterRunsByLog(allRuns, runIdsByLog?.runIdsByLogName[config.metric])
        : allRuns,
    [allRuns, runIdsByLog, config.metric],
  );

  if (!config.metric) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        Select a histogram metric
      </div>
    );
  }

  // Two different empty states, and telling them apart matters: since the
  // narrowing landed, `runs` can be empty because nothing is selected OR
  // because none of the selected runs logged this metric. Saying "select some
  // runs" to someone who has 200 selected sends them to do the one thing that
  // cannot help.
  if (runs.length === 0) {
    const nothingSelected = allRuns.length === 0;
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <div className="text-center">
          <p>{nothingSelected ? "No runs selected" : "No data for this metric"}</p>
          <p className="text-xs">
            {nothingSelected
              ? "Select runs from the list to view data"
              : `None of the selected runs logged ${config.metric}`}
          </p>
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
