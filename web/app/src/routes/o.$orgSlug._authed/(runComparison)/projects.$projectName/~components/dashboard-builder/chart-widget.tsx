import { useMemo } from "react";
import { useQueries } from "@tanstack/react-query";
import { trpc } from "@/utils/trpc";
import type { ChartWidgetConfig } from "../../~types/dashboard-types";
import type { GroupedMetrics } from "@/lib/grouping/types";
import type { SelectedRunWithColor } from "../../~hooks/use-selected-runs";
import { MultiLineChart } from "../multi-group/line-chart-multi";
import { resolveMetrics, isGlobValue, getGlobPattern, isRegexValue, getRegexPattern, isPatternValue } from "./glob-utils";
import { useRunMetricNames } from "../../~queries/metric-summaries";
import { formatRunLabel } from "@/lib/format-run-label";
import { getDisplayIdForRun } from "../../~lib/metrics-utils";
import { mapXAxisToDisplayLogName } from "./x-axis-utils";

/** Cap parallel pattern-resolution queries per widget to prevent request storms */
const MAX_PATTERN_QUERIES = 20;

interface ChartWidgetProps {
  config: ChartWidgetConfig;
  groupedMetrics: GroupedMetrics;
  selectedRuns: Record<string, SelectedRunWithColor>;
  organizationId: string;
  projectName: string;
  settingsRunId?: string;
  /** Externally-stored Y zoom range for persistence across mini/fullscreen */
  yZoomRange?: [number, number] | null;
  /** Called when user drags to zoom Y axis, or null on reset */
  onYZoomRangeChange?: (range: [number, number] | null) => void;
}

export function ChartWidget({
  config,
  groupedMetrics,
  selectedRuns,
  organizationId,
  projectName,
  settingsRunId,
  yZoomRange,
  onYZoomRangeChange,
}: ChartWidgetProps) {
  const lines = useMemo(() => {
    return Object.entries(selectedRuns).map(([runId, { run, color }]) => ({
      runId,
      runName: formatRunLabel(run.name, getDisplayIdForRun(run)),
      rawRunName: run.name,
      color,
      displayId: getDisplayIdForRun(run),
      createdAt: run.createdAt,
      forkStep: (run as any).forkStep != null ? Number((run as any).forkStep) : null,
      forkedFromRunId: (run as any).forkedFromRunId != null ? String((run as any).forkedFromRunId) : null,
    }));
  }, [selectedRuns]);

  const allRunsCompleted = useMemo(() => {
    return Object.values(selectedRuns).every(
      ({ run }) => run.status === "COMPLETED" || run.status === "FAILED"
    );
  }, [selectedRuns]);

  const hasPatterns = config.metrics?.some(isPatternValue) ?? false;
  const selectedRunIds = useMemo(() => Object.keys(selectedRuns), [selectedRuns]);

  const globBases = useMemo(() => {
    if (!config.metrics) return [];
    return [...new Set(
      config.metrics
        .filter(isGlobValue)
        .map((v) => getGlobPattern(v).replace(/[*?]/g, ""))
        .filter((base) => base.length > 0)
    )].slice(0, MAX_PATTERN_QUERIES);
  }, [config.metrics]);

  const regexPatterns = useMemo(() => {
    if (!config.metrics) return [];
    return config.metrics
      .filter(isRegexValue)
      .map((v) => getRegexPattern(v))
      .slice(0, MAX_PATTERN_QUERIES);
  }, [config.metrics]);

  const { data: allMetricNames } = useRunMetricNames(
    organizationId, projectName, selectedRunIds
  );

  const globSearchResults = useQueries({
    queries: globBases.map((base) =>
      trpc.runs.distinctMetricNames.queryOptions({
        organizationId, projectName, search: base, runIds: selectedRunIds,
      })
    ),
  });

  const regexSearchResults = useQueries({
    queries: regexPatterns.map((pattern) =>
      trpc.runs.distinctMetricNames.queryOptions({
        organizationId, projectName, regex: pattern, runIds: selectedRunIds,
      })
    ),
  });

  const metrics = useMemo(() => {
    if (!config.metrics || config.metrics.length === 0) return [];
    if (!hasPatterns) return config.metrics;

    const available = new Set<string>();
    for (const name of allMetricNames?.metricNames ?? []) available.add(name);
    for (const result of globSearchResults) {
      for (const name of result.data?.metricNames ?? []) available.add(name);
    }
    for (const result of regexSearchResults) {
      for (const name of result.data?.metricNames ?? []) available.add(name);
    }

    return resolveMetrics(config.metrics, Array.from(available));
  }, [config.metrics, hasPatterns, allMetricNames, globSearchResults, regexSearchResults]);

  // Compute display title and tooltip subtitle before early returns
  const rawEntries = config.metrics ?? [];
  const chipLabel = rawEntries.length >= 1 && rawEntries.length <= 3
    ? rawEntries.map((v) => {
        if (isGlobValue(v)) return getGlobPattern(v);
        if (isRegexValue(v)) return getRegexPattern(v);
        return v;
      }).join(", ")
    : metrics.length > 0 ? `${metrics.length} metrics` : "";
  const displayTitle = config.title || chipLabel;
  const tooltipSubtitle = chipLabel;

  if (!metrics || metrics.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <div className="text-center">
          <p>No metric configured</p>
        </div>
      </div>
    );
  }

  if (lines.length === 0) {
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
    <div className="flex h-full flex-col">
      <MultiLineChart
        lines={lines}
        title={displayTitle}
        subtitle={tooltipSubtitle}
        metrics={metrics}
        xlabel={config.xAxis === "time" ? "time" : "step"}
        organizationId={organizationId}
        projectName={projectName}
        allRunsCompleted={allRunsCompleted}
        logXAxis={config.xAxisScale === "log" ? true : undefined}
        logYAxis={config.yAxisScale === "log" ? true : undefined}
        xAxisOverride={mapXAxisToDisplayLogName(config.xAxis)}
        settingsRunId={settingsRunId}
        yZoomRange={yZoomRange}
        onYZoomRangeChange={onYZoomRangeChange}
      />
    </div>
  );
}
