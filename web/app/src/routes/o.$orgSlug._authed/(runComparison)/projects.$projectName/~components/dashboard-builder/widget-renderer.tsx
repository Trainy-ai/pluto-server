import { useMemo } from "react";
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

  // Get the metric name (we only support single metric per chart widget for now)
  const metricName = config.metrics[0];

  if (!metricName) {
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
        title={metricName}
        xlabel={config.xAxis === "time" ? "time" : "step"}
        organizationId={organizationId}
        projectName={projectName}
        allRunsCompleted={allRunsCompleted}
        yMin={config.yMin}
        yMax={config.yMax}
        onDataRange={onDataRange}
        onResetBounds={onResetBounds}
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
