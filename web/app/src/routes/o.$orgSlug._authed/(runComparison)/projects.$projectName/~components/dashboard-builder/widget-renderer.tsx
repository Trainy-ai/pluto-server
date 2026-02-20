import { useMemo } from "react";
import { useQueries } from "@tanstack/react-query";
import { trpc } from "@/utils/trpc";
import type {
  Widget,
  ChartWidgetConfig,
  ScatterWidgetConfig,
  SingleValueWidgetConfig,
  HistogramWidgetConfig,
  FileSeriesWidgetConfig,
} from "../../~types/dashboard-types";
import type { GroupedMetrics } from "@/lib/grouping/types";
import type { SelectedRunWithColor } from "../../~hooks/use-selected-runs";
import { MultiLineChart } from "../multi-group/line-chart-multi";
import { MultiGroupImage } from "../multi-group/image";
import { MultiGroupVideo } from "../multi-group/video";
import { MultiGroupAudio } from "../multi-group/audio";
import { resolveMetrics, isGlobValue, getGlobPattern, isRegexValue, getRegexPattern, isPatternValue } from "./glob-utils";
import { useRunMetricNames } from "../../~queries/metric-summaries";
import { formatRunLabel } from "@/lib/format-run-label";
import { getDisplayIdForRun } from "../../~lib/metrics-utils";

interface WidgetRendererProps {
  widget: Widget;
  groupedMetrics: GroupedMetrics;
  selectedRuns: Record<string, SelectedRunWithColor>;
  organizationId: string;
  projectName: string;
  /** Callback fired when chart data range is computed (for clipping detection) */
  onDataRange?: (dataMin: number, dataMax: number) => void;
  /** Callback fired on double-click to reset Y-axis bounds for this chart */
  onResetBounds?: () => void;
}

export function WidgetRenderer({
  widget,
  groupedMetrics,
  selectedRuns,
  organizationId,
  projectName,
  onDataRange,
  onResetBounds,
}: WidgetRendererProps) {
  switch (widget.type) {
    case "chart":
      return (
        <ChartWidget
          config={widget.config as ChartWidgetConfig}
          groupedMetrics={groupedMetrics}
          selectedRuns={selectedRuns}
          organizationId={organizationId}
          projectName={projectName}
          onDataRange={onDataRange}
          onResetBounds={onResetBounds}
        />
      );
    case "scatter":
      return (
        <ScatterWidget
          config={widget.config as ScatterWidgetConfig}
          selectedRuns={selectedRuns}
        />
      );
    case "single-value":
      return (
        <SingleValueWidget
          config={widget.config as SingleValueWidgetConfig}
          selectedRuns={selectedRuns}
        />
      );
    case "histogram":
      return (
        <HistogramWidget
          config={widget.config as HistogramWidgetConfig}
          selectedRuns={selectedRuns}
        />
      );
    case "logs":
      return <LogsWidget />;
    case "file-series":
      return (
        <FileSeriesWidget
          config={widget.config as FileSeriesWidgetConfig}
          selectedRuns={selectedRuns}
          organizationId={organizationId}
          projectName={projectName}
        />
      );
    default:
      return (
        <div className="flex h-full items-center justify-center text-muted-foreground">
          Unknown widget type
        </div>
      );
  }
}

// Chart Widget - Line graph using MultiLineChart
function ChartWidget({
  config,
  groupedMetrics,
  selectedRuns,
  organizationId,
  projectName,
  onDataRange,
  onResetBounds,
}: {
  config: ChartWidgetConfig;
  groupedMetrics: GroupedMetrics;
  selectedRuns: Record<string, SelectedRunWithColor>;
  organizationId: string;
  projectName: string;
  onDataRange?: (dataMin: number, dataMax: number) => void;
  onResetBounds?: () => void;
}) {
  // Build lines array from selected runs
  const lines = useMemo(() => {
    return Object.entries(selectedRuns).map(([runId, { run, color }]) => ({
      runId,
      runName: formatRunLabel(run.name, getDisplayIdForRun(run)),
      color,
    }));
  }, [selectedRuns]);

  // Check if all runs are completed (for caching optimization)
  const allRunsCompleted = useMemo(() => {
    return Object.values(selectedRuns).every(
      ({ run }) => run.status === "COMPLETED" || run.status === "FAILED"
    );
  }, [selectedRuns]);

  // Resolve glob/regex patterns in metrics to actual metric names
  const hasPatterns = config.metrics?.some(isPatternValue) ?? false;

  // Selected run IDs — scope all metric resolution to these runs only
  const selectedRunIds = useMemo(() => Object.keys(selectedRuns), [selectedRuns]);

  // Extract glob search bases (e.g., "glob:test/*" → "test/")
  const globBases = useMemo(() => {
    if (!config.metrics) return [];
    return [...new Set(
      config.metrics
        .filter(isGlobValue)
        .map((v) => getGlobPattern(v).replace(/[*?]/g, ""))
        .filter((base) => base.length > 0)
    )];
  }, [config.metrics]);

  // Extract regex patterns for server-side regex search
  const regexPatterns = useMemo(() => {
    if (!config.metrics) return [];
    return config.metrics
      .filter(isRegexValue)
      .map((v) => getRegexPattern(v));
  }, [config.metrics]);

  // Fetch metrics scoped to selected runs (not project-wide)
  const { data: allMetricNames } = useRunMetricNames(
    organizationId,
    projectName,
    selectedRunIds
  );

  // Search for each glob base via ILIKE, scoped to selected runs
  const globSearchResults = useQueries({
    queries: globBases.map((base) =>
      trpc.runs.distinctMetricNames.queryOptions({
        organizationId,
        projectName,
        search: base,
        runIds: selectedRunIds,
      })
    ),
  });

  // Search for each regex pattern via ClickHouse match(), scoped to selected runs
  const regexSearchResults = useQueries({
    queries: regexPatterns.map((pattern) =>
      trpc.runs.distinctMetricNames.queryOptions({
        organizationId,
        projectName,
        regex: pattern,
        runIds: selectedRunIds,
      })
    ),
  });

  const metrics = useMemo(() => {
    if (!config.metrics || config.metrics.length === 0) return [];
    if (!hasPatterns) return config.metrics;

    // Merge initial + glob search + regex search results for comprehensive resolution
    const available = new Set<string>();
    for (const name of allMetricNames?.metricNames ?? []) {
      available.add(name);
    }
    for (const result of globSearchResults) {
      for (const name of result.data?.metricNames ?? []) {
        available.add(name);
      }
    }
    for (const result of regexSearchResults) {
      for (const name of result.data?.metricNames ?? []) {
        available.add(name);
      }
    }

    return resolveMetrics(config.metrics, Array.from(available));
  }, [config.metrics, hasPatterns, allMetricNames, globSearchResults, regexSearchResults]);

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

  // For display title: custom title takes priority, then single metric name, then count
  const displayTitle = config.title
    || (metrics.length === 1 ? metrics[0] : `${metrics.length} metrics`);

  return (
    <div className="flex h-full flex-col">
      <MultiLineChart
        lines={lines}
        title={displayTitle}
        metrics={metrics}
        xlabel={config.xAxis === "time" ? "time" : "step"}
        organizationId={organizationId}
        projectName={projectName}
        allRunsCompleted={allRunsCompleted}
        yMin={config.yMin}
        yMax={config.yMax}
        onDataRange={onDataRange}
        onResetBounds={onResetBounds}
        logXAxis={config.xAxisScale === "log"}
        logYAxis={config.yAxisScale === "log"}
      />
    </div>
  );
}

// Scatter Plot Widget
function ScatterWidget({
  config,
  selectedRuns,
}: {
  config: ScatterWidgetConfig;
  selectedRuns: Record<string, SelectedRunWithColor>;
}) {
  const runCount = Object.keys(selectedRuns).length;

  if (!config.xMetric || !config.yMetric) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        Configure X and Y metrics
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 flex items-center justify-center bg-muted/20 rounded">
        <div className="text-center text-muted-foreground">
          <p className="text-sm font-medium">
            {config.xMetric} vs {config.yMetric}
          </p>
          <p className="text-xs mt-1">
            X: {config.xScale} ({config.xAggregation})
          </p>
          <p className="text-xs">
            Y: {config.yScale} ({config.yAggregation})
          </p>
          <p className="text-xs mt-2">
            {runCount} runs
          </p>
        </div>
      </div>
    </div>
  );
}

// Single Value Widget
function SingleValueWidget({
  config,
  selectedRuns,
}: {
  config: SingleValueWidgetConfig;
  selectedRuns: Record<string, SelectedRunWithColor>;
}) {
  if (!config.metric) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        Select a metric
      </div>
    );
  }

  // Placeholder - would compute actual value from runs data
  const value = "--";

  return (
    <div className="flex h-full flex-col items-center justify-center">
      <div className="text-4xl font-bold">
        {config.prefix}
        {value}
        {config.suffix}
      </div>
      <div className="text-sm text-muted-foreground mt-1">
        {config.metric} ({config.aggregation})
      </div>
    </div>
  );
}

// Histogram Widget
function HistogramWidget({
  config,
  selectedRuns,
}: {
  config: HistogramWidgetConfig;
  selectedRuns: Record<string, SelectedRunWithColor>;
}) {
  const runCount = Object.keys(selectedRuns).length;

  if (!config.metric) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        Select a metric
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 flex items-center justify-center bg-muted/20 rounded">
        <div className="text-center text-muted-foreground">
          <p className="text-sm font-medium">Histogram: {config.metric}</p>
          <p className="text-xs mt-1">
            {config.bins} bins | Step: {config.step}
          </p>
          <p className="text-xs mt-2">
            {runCount} runs
          </p>
        </div>
      </div>
    </div>
  );
}

// Logs Widget (placeholder)
function LogsWidget() {
  return (
    <div className="flex h-full items-center justify-center text-muted-foreground">
      <div className="text-center">
        <p className="text-sm">Logs viewer</p>
        <p className="text-xs">Coming soon</p>
      </div>
    </div>
  );
}

// Media Widget - Images, Videos, Audio
function FileSeriesWidget({
  config,
  selectedRuns,
  organizationId,
  projectName,
}: {
  config: FileSeriesWidgetConfig;
  selectedRuns: Record<string, SelectedRunWithColor>;
  organizationId: string;
  projectName: string;
}) {
  // Build runs array from selected runs
  const runs = useMemo(() => {
    return Object.entries(selectedRuns).map(([runId, { run, color }]) => ({
      runId,
      runName: formatRunLabel(run.name, getDisplayIdForRun(run)),
      color,
    }));
  }, [selectedRuns]);

  if (!config.logName) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <div className="text-center">
          <p>No media log configured</p>
        </div>
      </div>
    );
  }

  if (runs.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <div className="text-center">
          <p>No runs selected</p>
          <p className="text-xs">Select runs from the list to view media</p>
        </div>
      </div>
    );
  }

  // Render appropriate component based on media type
  switch (config.mediaType) {
    case "IMAGE":
      return (
        <MultiGroupImage
          logName={config.logName}
          organizationId={organizationId}
          projectName={projectName}
          runs={runs}
          className="h-full"
        />
      );
    case "VIDEO":
      return (
        <MultiGroupVideo
          logName={config.logName}
          organizationId={organizationId}
          projectName={projectName}
          runs={runs}
          className="h-full"
        />
      );
    case "AUDIO":
      return (
        <MultiGroupAudio
          logName={config.logName}
          organizationId={organizationId}
          projectName={projectName}
          runs={runs}
          className="h-full"
        />
      );
    default:
      return (
        <div className="flex h-full items-center justify-center text-muted-foreground">
          <div className="text-center">
            <p>Unsupported media type</p>
          </div>
        </div>
      );
  }
}
