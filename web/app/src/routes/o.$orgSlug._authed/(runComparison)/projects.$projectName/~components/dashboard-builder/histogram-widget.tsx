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
}

export function HistogramWidget({
  config,
  selectedRuns,
  organizationId,
  projectName,
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
    />
  );
}
