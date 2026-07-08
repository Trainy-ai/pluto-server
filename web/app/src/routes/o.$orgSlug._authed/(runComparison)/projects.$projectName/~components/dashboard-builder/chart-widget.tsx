import { useMemo } from "react";
import { useQueries } from "@tanstack/react-query";
import { trpc } from "@/utils/trpc";
import type { ChartWidgetConfig } from "../../~types/dashboard-types";
import type { GroupedMetrics } from "@/lib/grouping/types";
import type { SelectedRunWithColor } from "../../~hooks/use-selected-runs";
import { MultiLineChart } from "../multi-group/line-chart-multi";
import { GroupedLineChart } from "../multi-group/grouped-line-chart";
import {
  resolveMetrics,
  isGlobValue,
  getGlobPattern,
  isRegexValue,
  getRegexPattern,
  isPatternValue,
} from "./glob-utils";
import { useRunMetricNames } from "../../~queries/metric-summaries";
import { formatRunLabel } from "@/lib/format-run-label";
import { getDisplayIdForRun } from "../../~lib/metrics-utils";
import { mapXAxisToDisplayLogName } from "./x-axis-utils";
import { useLineSettings } from "@/routes/o.$orgSlug._authed/(run)/projects.$projectName.$runId/~components/use-line-settings";

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
  /** Encoded grouping chain — when non-empty, the widget renders one
   *  line + min/max band per group via <GroupedLineChart> instead of
   *  one line per run via <MultiLineChart>. */
  groupBy?: string[];
  /** Run IDs the user has hidden from charts; excluded from the
   *  grouped aggregate so the band/mean re-shapes as eyes toggle. */
  hiddenRunIds?: string[];
}

export function ChartWidget({
  config,
  groupedMetrics: _groupedMetrics,
  selectedRuns,
  organizationId,
  projectName,
  settingsRunId,
  yZoomRange,
  onYZoomRangeChange,
  groupBy,
  hiddenRunIds,
}: ChartWidgetProps) {
  void _groupedMetrics; // currently unused — kept on the interface for parity with other widgets

  const lines = useMemo(() => {
    return Object.entries(selectedRuns).map(([runId, { run, color }]) => ({
      runId,
      runName: formatRunLabel(run.name, getDisplayIdForRun(run)),
      rawRunName: run.name,
      color,
      displayId: getDisplayIdForRun(run),
      createdAt: run.createdAt,
      forkStep:
        (run as { forkStep?: unknown }).forkStep != null
          ? Number((run as { forkStep?: unknown }).forkStep)
          : null,
      forkedFromRunId:
        (run as { forkedFromRunId?: unknown }).forkedFromRunId != null
          ? String((run as { forkedFromRunId?: unknown }).forkedFromRunId)
          : null,
    }));
  }, [selectedRuns]);

  const allRunsCompleted = useMemo(() => {
    return Object.values(selectedRuns).every(
      ({ run }) => run.status === "COMPLETED" || run.status === "FAILED",
    );
  }, [selectedRuns]);

  const hasPatterns = config.metrics?.some(isPatternValue) ?? false;
  const selectedRunIds = useMemo(() => Object.keys(selectedRuns), [selectedRuns]);

  const globBases = useMemo(() => {
    if (!config.metrics) return [];
    return [
      ...new Set(
        config.metrics
          .filter(isGlobValue)
          .map((v) => getGlobPattern(v).replace(/[*?]/g, ""))
          .filter((base) => base.length > 0),
      ),
    ].slice(0, MAX_PATTERN_QUERIES);
  }, [config.metrics]);

  const regexPatterns = useMemo(() => {
    if (!config.metrics) return [];
    return config.metrics
      .filter(isRegexValue)
      .map((v) => getRegexPattern(v))
      .slice(0, MAX_PATTERN_QUERIES);
  }, [config.metrics]);

  // Respect the "Include NaN/Inf-only metrics" toggle from line settings.
  // When ON, pattern resolution queries fall back to the raw mlop_metrics
  // table so metrics whose values are entirely NaN/Inf are included in the
  // match set.
  const { settings } = useLineSettings(
    organizationId,
    projectName,
    settingsRunId ?? "full",
  );
  const includeNonFiniteMetrics = settings.includeNonFiniteMetrics ?? false;

  const { data: allMetricNames } = useRunMetricNames(
    organizationId,
    projectName,
    selectedRunIds,
    includeNonFiniteMetrics,
  );

  const globSearchResults = useQueries({
    queries: globBases.map((base) =>
      trpc.runs.distinctMetricNames.queryOptions({
        organizationId,
        projectName,
        search: base,
        runIds: selectedRunIds,
        ...(includeNonFiniteMetrics ? { includeNonFiniteMetrics } : {}),
      }),
    ),
  });

  const regexSearchResults = useQueries({
    queries: regexPatterns.map((pattern) =>
      trpc.runs.distinctMetricNames.queryOptions({
        organizationId,
        projectName,
        regex: pattern,
        runIds: selectedRunIds,
        ...(includeNonFiniteMetrics ? { includeNonFiniteMetrics } : {}),
      }),
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
  }, [
    config.metrics,
    hasPatterns,
    allMetricNames,
    globSearchResults,
    regexSearchResults,
  ]);

  // Compute display title and tooltip subtitle before early returns
  const rawEntries = config.metrics ?? [];
  const chipLabel =
    rawEntries.length >= 1 && rawEntries.length <= 3
      ? rawEntries
          .map((v) => {
            if (isGlobValue(v)) return getGlobPattern(v);
            if (isRegexValue(v)) return getRegexPattern(v);
            return v;
          })
          .join(", ")
      : metrics.length > 0
        ? `${metrics.length} metrics`
        : "";
  const displayTitle = config.title || chipLabel;
  // When the widget has its own title (e.g. dynamic-section combined widgets
  // titled `prefix (max, mean, min)`), avoid duplicating the suffix list as
  // a long metric-names subtitle — just show the count, matching the
  // static-section convention for many-metric widgets.
  const tooltipSubtitle = config.title
    ? metrics.length > 0
      ? `${metrics.length} metric${metrics.length === 1 ? "" : "s"}`
      : ""
    : chipLabel;

  if (metrics.length === 0) {
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

  // Per-widget grouping opt-out via Chart Settings popover.
  const effectiveGroupBy =
    config.groupingOverride === "off" ? undefined : groupBy;

  // Grouped path — replaces MultiLineChart entirely when the page has
  // an active groupBy AND the widget has not opted out. Tradeoffs
  // (zoom-refetch / smoothing / lineage) are documented in
  // PLAN-grouping-v2-charts.md and grouped-line-chart.tsx.
  if (effectiveGroupBy && effectiveGroupBy.length > 0) {
    return (
      <div className="flex h-full flex-col">
        <GroupedLineChart
          organizationId={organizationId}
          projectName={projectName}
          groupBy={effectiveGroupBy}
          metrics={metrics}
          // The user's comparison — backend filters by `id IN
          // (selectedRunIds)` before grouping so the chart aggregates
          // ONLY over selected runs (matches flat-mode behaviour).
          selectedRunIds={selectedRunIds}
          hiddenRunIds={hiddenRunIds}
          title={displayTitle}
          subtitle={tooltipSubtitle}
          xlabel={
            config.xAxis === "time" || config.xAxis === "absolute-time"
              ? "time"
              : config.xAxis === "relative-time"
                ? "time (s)"
                : "step"
          }
          // Step / absolute-time / relative-time wired through for
          // grouped charts. Custom-metric x-axis falls back to step;
          // see PLAN-grouping-v2-charts.md.
          xAxis={
            config.xAxis === "time" || config.xAxis === "absolute-time"
              ? "time"
              : config.xAxis === "relative-time"
                ? "relative-time"
                : "step"
          }
          logXAxis={config.xAxisScale === "log" ? true : undefined}
          logYAxis={config.yAxisScale === "log" ? true : undefined}
          yZoomRange={yZoomRange}
          onYZoomRangeChange={onYZoomRangeChange}
          settingsRunId={settingsRunId}
          maxGroups={config.maxGroups}
        />
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
