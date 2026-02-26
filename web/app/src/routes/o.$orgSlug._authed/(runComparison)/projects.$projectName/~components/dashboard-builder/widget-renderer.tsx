import { useMemo } from "react";
import { useQueries } from "@tanstack/react-query";
import { trpc } from "@/utils/trpc";
import type {
  Widget,
  ChartWidgetConfig,
  HistogramWidgetConfig,
  FileGroupWidgetConfig,
} from "../../~types/dashboard-types";
import type { GroupedMetrics } from "@/lib/grouping/types";
import type { SelectedRunWithColor } from "../../~hooks/use-selected-runs";
import { MultiLineChart } from "../multi-group/line-chart-multi";
import { MultiHistogramView } from "../multi-group/histogram-view";
import { MultiGroupImage } from "../multi-group/image";
import { MultiGroupVideo } from "../multi-group/video";
import { MultiGroupAudio } from "../multi-group/audio";
import { resolveMetrics, isGlobValue, getGlobPattern, isRegexValue, getRegexPattern, isPatternValue } from "./glob-utils";
import { useRunMetricNames } from "../../~queries/metric-summaries";
import { useRunFileLogNames } from "../../~queries/file-log-names";
import { formatRunLabel } from "@/lib/format-run-label";
import { getDisplayIdForRun } from "../../~lib/metrics-utils";
import { SYNTHETIC_CONSOLE_ENTRIES, isConsoleLogType } from "./console-log-constants";
import { ConsoleLogWidget } from "./console-log-widget";

/** Cap parallel pattern-resolution queries per widget to prevent request storms */
const MAX_PATTERN_QUERIES = 20;

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
    case "histogram":
      return (
        <HistogramWidget
          config={widget.config as HistogramWidgetConfig}
          selectedRuns={selectedRuns}
          organizationId={organizationId}
          projectName={projectName}
        />
      );
    case "file-group":
      return (
        <FileGroupWidget
          config={widget.config as FileGroupWidgetConfig}
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
    )].slice(0, MAX_PATTERN_QUERIES);
  }, [config.metrics]);

  // Extract regex patterns for server-side regex search
  const regexPatterns = useMemo(() => {
    if (!config.metrics) return [];
    return config.metrics
      .filter(isRegexValue)
      .map((v) => getRegexPattern(v))
      .slice(0, MAX_PATTERN_QUERIES);
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

  // Compute display title and tooltip subtitle before early returns to avoid hook ordering issues
  const rawEntries = config.metrics ?? [];
  const chipLabel = rawEntries.length >= 1 && rawEntries.length <= 3
    ? rawEntries.map((v) => {
        if (isGlobValue(v)) return getGlobPattern(v);
        if (isRegexValue(v)) return getRegexPattern(v);
        return v;
      }).join(", ")
    : metrics.length > 0 ? `${metrics.length} metrics` : "";
  // Chart header title: custom title or chip names
  const displayTitle = config.title || chipLabel;
  // Tooltip subtitle: always show chip names (separate from title so both can appear)
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

// Histogram Widget
function HistogramWidget({
  config,
  selectedRuns,
  organizationId,
  projectName,
}: {
  config: HistogramWidgetConfig;
  selectedRuns: Record<string, SelectedRunWithColor>;
  organizationId: string;
  projectName: string;
}) {
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

// File Group Widget — renders multiple file logs (histograms, images, videos, audio)
// with dynamic pattern resolution at render time (mirrors ChartWidget's pipeline)
function FileGroupWidget({
  config,
  selectedRuns,
  organizationId,
  projectName,
}: {
  config: FileGroupWidgetConfig;
  selectedRuns: Record<string, SelectedRunWithColor>;
  organizationId: string;
  projectName: string;
}) {
  const runs = useMemo(() => {
    return Object.entries(selectedRuns).map(([runId, { run, color }]) => ({
      runId,
      runName: formatRunLabel(run.name, getDisplayIdForRun(run)),
      color,
    }));
  }, [selectedRuns]);

  const selectedRunIds = useMemo(() => Object.keys(selectedRuns), [selectedRuns]);

  // Detect if we have any dynamic patterns
  const hasPatterns = config.files?.some(isPatternValue) ?? false;

  // Extract glob search bases
  const globBases = useMemo(() => {
    if (!config.files) return [];
    return [...new Set(
      config.files
        .filter(isGlobValue)
        .map((v) => getGlobPattern(v).replace(/[*?]/g, ""))
        .filter((base) => base.length > 0)
    )].slice(0, MAX_PATTERN_QUERIES);
  }, [config.files]);

  // Extract regex patterns
  const regexPatterns = useMemo(() => {
    if (!config.files) return [];
    return config.files
      .filter(isRegexValue)
      .map((v) => getRegexPattern(v))
      .slice(0, MAX_PATTERN_QUERIES);
  }, [config.files]);

  // Fetch all file log names for selected runs
  const { data: allFileNames } = useRunFileLogNames(
    organizationId,
    projectName,
    selectedRunIds
  );

  // Glob search: query for each glob base
  const globSearchResults = useQueries({
    queries: globBases.map((base) =>
      trpc.runs.distinctFileLogNames.queryOptions({
        organizationId,
        projectName,
        search: base,
        runIds: selectedRunIds,
      })
    ),
  });

  // Regex search: query for each regex pattern
  const regexSearchResults = useQueries({
    queries: regexPatterns.map((pattern) =>
      trpc.runs.distinctFileLogNames.queryOptions({
        organizationId,
        projectName,
        regex: pattern,
        runIds: selectedRunIds,
      })
    ),
  });

  // Build type map and resolve file names
  const { resolvedFiles, typeMap } = useMemo(() => {
    const tMap = new Map<string, string>();
    const available = new Set<string>();

    // Inject synthetic console log entries
    for (const e of SYNTHETIC_CONSOLE_ENTRIES) {
      available.add(e.logName);
      tMap.set(e.logName, e.logType);
    }

    // Collect all file names and their types from all sources
    for (const f of allFileNames?.files ?? []) {
      available.add(f.logName);
      tMap.set(f.logName, f.logType);
    }
    for (const result of globSearchResults) {
      for (const f of result.data?.files ?? []) {
        available.add(f.logName);
        tMap.set(f.logName, f.logType);
      }
    }
    for (const result of regexSearchResults) {
      for (const f of result.data?.files ?? []) {
        available.add(f.logName);
        tMap.set(f.logName, f.logType);
      }
    }

    if (!config.files || config.files.length === 0) {
      return { resolvedFiles: [], typeMap: tMap };
    }

    if (!hasPatterns) {
      return { resolvedFiles: config.files, typeMap: tMap };
    }

    const resolved = resolveMetrics(config.files, Array.from(available));
    return { resolvedFiles: resolved, typeMap: tMap };
  }, [config.files, hasPatterns, allFileNames, globSearchResults, regexSearchResults]);

  if (!resolvedFiles || resolvedFiles.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <div className="text-center">
          <p>No files configured</p>
        </div>
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

  // Group resolved files by type for rendering
  const grouped = new Map<string, string[]>();
  for (const file of resolvedFiles) {
    const logType = typeMap.get(file) ?? "HISTOGRAM";
    const existing = grouped.get(logType) ?? [];
    existing.push(file);
    grouped.set(logType, existing);
  }

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto">
      {Array.from(grouped.entries()).map(([logType, files]) =>
        files.map((logName) => (
          <div
            key={logName}
            className="shrink-0"
            style={
              isConsoleLogType(logType)
                ? { height: 400 }
                : { minHeight: logType === "HISTOGRAM" ? 300 : 250 }
            }
          >
            <FileGroupEntry
              logName={logName}
              logType={logType}
              runs={runs}
              organizationId={organizationId}
              projectName={projectName}
            />
          </div>
        ))
      )}
    </div>
  );
}

// Renders a single file entry within a FileGroupWidget
function FileGroupEntry({
  logName,
  logType,
  runs,
  organizationId,
  projectName,
}: {
  logName: string;
  logType: string;
  runs: { runId: string; runName: string; color: string }[];
  organizationId: string;
  projectName: string;
}) {
  switch (logType) {
    case "HISTOGRAM":
      return (
        <MultiHistogramView
          logName={logName}
          tenantId={organizationId}
          projectName={projectName}
          runs={runs}
          className="h-full"
        />
      );
    case "IMAGE":
      return (
        <MultiGroupImage
          logName={logName}
          organizationId={organizationId}
          projectName={projectName}
          runs={runs}
          className="h-full"
        />
      );
    case "VIDEO":
      return (
        <MultiGroupVideo
          logName={logName}
          organizationId={organizationId}
          projectName={projectName}
          runs={runs}
          className="h-full"
        />
      );
    case "AUDIO":
      return (
        <MultiGroupAudio
          logName={logName}
          organizationId={organizationId}
          projectName={projectName}
          runs={runs}
          className="h-full"
        />
      );
    case "CONSOLE_STDOUT":
    case "CONSOLE_STDERR":
      return (
        <ConsoleLogWidget
          logType={logType as "CONSOLE_STDOUT" | "CONSOLE_STDERR"}
          runs={runs}
          organizationId={organizationId}
          projectName={projectName}
        />
      );
    default:
      return (
        <div className="rounded border p-2 text-center text-sm text-muted-foreground">
          Unsupported type: {logType} ({logName})
        </div>
      );
  }
}

