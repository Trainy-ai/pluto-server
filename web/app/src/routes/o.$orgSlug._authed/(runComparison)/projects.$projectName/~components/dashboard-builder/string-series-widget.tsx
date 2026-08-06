import { useMemo } from "react";
import { MultiGroupStringSeries } from "../multi-group/string-series";
import { formatRunLabel } from "@/lib/format-run-label";
import { getDisplayIdForRun } from "../../~lib/metrics-utils";
import type { StringSeriesWidgetConfig } from "../../~types/dashboard-types";
import type { SelectedRunWithColor } from "../../~hooks/use-selected-runs";

interface StringSeriesWidgetProps {
  config: StringSeriesWidgetConfig;
  selectedRuns: Record<string, SelectedRunWithColor>;
  organizationId: string;
  projectName: string;
  hiddenRunIds?: Set<string>;
}

/**
 * Dashboard widget for a string metric (`log("phase", "warmup")`).
 *
 * Thin adapter: it converts the dashboard's `selectedRuns` record into the run
 * list the all-runs widget already takes, so the staircase renders identically
 * on the Charts tab, in a saved dashboard and in a dynamic section rather than
 * three near-copies drifting apart.
 */
export function StringSeriesWidget({
  config,
  selectedRuns,
  organizationId,
  projectName,
  hiddenRunIds,
}: StringSeriesWidgetProps) {
  const runs = useMemo(
    () =>
      Object.entries(selectedRuns)
        .filter(([runId]) => !hiddenRunIds?.has(runId))
        .map(([runId, { run, color }]) => ({
          runId,
          runName: formatRunLabel(run.name, getDisplayIdForRun(run)),
          color,
          // The Relative Time baseline, exactly as the numeric ChartWidget
          // passes it. Dropping it here made a dashboard staircase baseline on
          // its first sample while the chart widget beside it baselined on run
          // start, so the two disagreed about where zero was.
          createdAt: run.createdAt,
        })),
    [selectedRuns, hiddenRunIds],
  );

  return (
    <MultiGroupStringSeries
      logName={config.metric}
      organizationId={organizationId}
      projectName={projectName}
      runs={runs}
      groupId={`dashboard-${projectName}`}
      className="h-full"
    />
  );
}
