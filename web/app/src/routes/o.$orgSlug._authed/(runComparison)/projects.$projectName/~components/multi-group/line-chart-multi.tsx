"use client";

import { default as LineChart, type RawLineData } from "@/components/charts/line-wrapper";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { memo, useMemo } from "react";
import { useQueries } from "@tanstack/react-query";
import { trpc, trpcClient } from "@/utils/trpc";
import { useCheckDatabaseSize } from "@/lib/db/local-cache";
import { metricsCache, type MetricDataPoint } from "@/lib/db/index";
import { useLocalQueries } from "@/lib/hooks/use-local-query";
import { useLineSettings } from "@/routes/o.$orgSlug._authed/(run)/projects.$projectName.$runId/~components/use-line-settings";
import { useZoomRefetch, zoomKey } from "@/lib/hooks/use-zoom-refetch";
import { useChartSyncContext } from "@/components/charts/context/chart-sync-context";
import {
  getTimeUnitForDisplay,
  alignAndUnzip,
  downsampleAndSmooth,
  buildValueFlags,
} from "@/lib/chart-data-utils";

// For active runs, refresh every 30 seconds
// For completed runs, data never changes so use Infinity
const ACTIVE_RUN_STALE_TIME = 30 * 1000; // 30 seconds
const COMPLETED_RUN_STALE_TIME = Infinity; // Never refetch completed runs
const GC_TIME = 0; // Immediate garbage collection when query is inactive

/** Preview tier: fast LIMIT query via batch, 1k points per run */
const PREVIEW_MAX_POINTS = 1000;

// Maximum number of series (metrics × runs) before showing a warning
const MAX_SERIES_COUNT = 200;

/** Distinct dash patterns per metric index (metric 0 = solid). */
const METRIC_DASH_PATTERNS: (number[] | undefined)[] = [
  undefined,     // metric 0: solid
  [10, 5],       // metric 1: dashed
  [2, 4],        // metric 2: dotted
  [10, 3, 2, 3], // metric 3: dash-dot
  [15, 5, 2, 5], // metric 4: long dash-dot
];

function getDashPattern(metricIndex: number): number[] | undefined {
  if (metricIndex < METRIC_DASH_PATTERNS.length) {
    return METRIC_DASH_PATTERNS[metricIndex];
  }
  // For 5+ metrics, cycle through patterns 1-4 (skip solid)
  return METRIC_DASH_PATTERNS[((metricIndex - 1) % 4) + 1];
}

interface MultiLineChartProps {
  lines: {
    runId: string;
    runName: string;
    color: string;
  }[];
  title: string;
  /** Optional array of metric names. When provided, fetches all metrics for each run.
   *  When omitted, falls back to [title] for backward compatibility (All Metrics view). */
  metrics?: string[];
  xlabel: string;
  organizationId: string;
  projectName: string;
  /** When true, all runs are in a terminal state and data won't change */
  allRunsCompleted?: boolean;
  /** Manual Y-axis minimum bound */
  yMin?: number;
  /** Manual Y-axis maximum bound */
  yMax?: number;
  /** Callback fired when the actual data range (min/max of all Y values) is computed */
  onDataRange?: (dataMin: number, dataMax: number) => void;
  /** Callback fired on double-click to reset Y-axis bounds for this chart */
  onResetBounds?: () => void;
  /** Override log X-axis scale (per-widget config takes precedence over global settings) */
  logXAxis?: boolean;
  /** Override log Y-axis scale (per-widget config takes precedence over global settings) */
  logYAxis?: boolean;
}

/** Props for the inner memo'd component (includes syncedZoomRange) */
interface MultiLineChartInnerProps extends MultiLineChartProps {
  syncedZoomRange: [number, number] | null;
}


/**
 * Wrapper that reads syncedZoomRange from chart sync context and passes it
 * as a prop to the memo'd inner component. This avoids subscribing the memo'd
 * component to the entire context (which would bypass memo and cause chart
 * recreations on every hover-triggered context update).
 */
export function MultiLineChart(props: MultiLineChartProps) {
  const chartSyncContext = useChartSyncContext();
  const syncedZoomRange = chartSyncContext?.syncedZoomRange ?? null;
  return <MultiLineChartInner {...props} syncedZoomRange={syncedZoomRange} />;
}

const MultiLineChartInner = memo(
  ({
    lines,
    title,
    metrics: metricsProp,
    xlabel,
    organizationId,
    projectName,
    allRunsCompleted = false,
    yMin,
    yMax,
    onDataRange,
    onResetBounds,
    syncedZoomRange,
    logXAxis: logXAxisOverride,
    logYAxis: logYAxisOverride,
  }: MultiLineChartInnerProps) => {
    useCheckDatabaseSize(metricsCache);

    // Resolve metrics list: use prop if provided, otherwise fall back to [title]
    const metricNames = useMemo(
      () => metricsProp ?? [title],
      [metricsProp, title],
    );
    const isMultiMetric = metricNames.length > 1;
    const isMultiRun = lines.length > 1;

    // Use global chart settings with runId="full"
    const { settings } = useLineSettings(organizationId, projectName, "full");

    // Per-widget log scale overrides take precedence over global settings
    const logXAxis = logXAxisOverride ?? settings.xAxisLogScale;
    const logYAxis = logYAxisOverride ?? settings.yAxisLogScale;

    // Use Infinity staleTime for completed runs since their data won't change
    const staleTime = allRunsCompleted ? COMPLETED_RUN_STALE_TIME : ACTIVE_RUN_STALE_TIME;

    // Build flat array of query pairs: { metric, line, metricIndex }
    // for N metrics × M runs
    const queryPairs = useMemo(
      () =>
        metricNames.flatMap((metric, metricIndex) =>
          lines.map((line) => ({ metric, line, metricIndex }))
        ),
      [metricNames, lines]
    );

    // Safety check: too many series
    const tooManySeries = queryPairs.length > MAX_SERIES_COUNT;

    // Fetch data for all metric×run pairs in parallel
    const queries = useLocalQueries<MetricDataPoint>(
      tooManySeries
        ? []
        : queryPairs.map((pair) => {
            const opts = {
              organizationId,
              projectName,
              runId: pair.line.runId,
              logName: pair.metric,
            };

            const queryOptions = trpc.runs.data.graph.queryOptions(opts);

            return {
              queryKey: queryOptions.queryKey,
              queryFn: () => trpcClient.runs.data.graph.query(opts),
              staleTime,
              gcTime: GC_TIME,
              localCache: metricsCache,
              enabled: true,
            };
          }),
    );

    // === Batch preview tier: 1 query per metric for all runs (fast LIMIT) ===
    // Provides instant chart shapes while individual standard queries load.
    // Disabled once any standard data arrives (preview is lower resolution).
    const hasAnyStandard = queries.some(
      (q) => q.data !== undefined && (q.data as MetricDataPoint[]).length > 0,
    );

    const runIds = useMemo(() => lines.map((l) => l.runId), [lines]);

    const previewQueries = useQueries({
      queries: tooManySeries
        ? []
        : metricNames.map((metric) => {
            const opts = {
              organizationId,
              projectName,
              logName: metric,
              runIds,
              maxPoints: PREVIEW_MAX_POINTS,
              preview: true,
            };
            return {
              queryKey: [
                ...trpc.runs.data.graphBatch.queryOptions(opts).queryKey,
                "preview",
              ],
              queryFn: () => trpcClient.runs.data.graphBatch.query(opts),
              staleTime: Infinity,
              gcTime: 0,
              enabled: runIds.length > 0 && !hasAnyStandard,
            };
          }),
    });

    // Build a lookup: metric → runId → preview points
    const previewDataMap = useMemo(() => {
      const map = new Map<string, Record<string, MetricDataPoint[]>>();
      metricNames.forEach((metric, i) => {
        const data = previewQueries[i]?.data as
          | Record<string, MetricDataPoint[]>
          | undefined;
        if (data) {
          map.set(metric, data);
        }
      });
      return map;
    }, [metricNames, previewQueries]);

    // If the selected log is not a standard one, fetch that data for each run
    // to use as x-axis values (only need one per run, not per metric)
    const customLogQueries = useLocalQueries<MetricDataPoint>(
      settings.selectedLog !== "Step" &&
        settings.selectedLog !== "Absolute Time" &&
        settings.selectedLog !== "Relative Time"
        ? lines.map((line) => {
            const opts = {
              organizationId,
              projectName,
              runId: line.runId,
              logName: settings.selectedLog,
            };

            const queryOptions = trpc.runs.data.graph.queryOptions(opts);

            return {
              queryKey: queryOptions.queryKey,
              queryFn: () => trpcClient.runs.data.graph.query(opts),
              staleTime,
              gcTime: GC_TIME,
              localCache: metricsCache,
              enabled: true,
            };
          })
        : [],
    );

    // Zoom-triggered server re-fetch for full-resolution data (Step mode only)
    // Supports single and multi-metric: fires one batch/individual query per metric
    const { zoomDataMap, onZoomRangeChange, isZoomFetching } = useZoomRefetch({
      organizationId,
      projectName,
      logNames: metricNames,
      runIds,
      selectedLog: settings.selectedLog,
      staleTime,
      syncedZoomRange,
    });

    // Check error states and get data
    const isError = queries.some((query) => query.isError);

    // Build series label based on multi-metric / multi-run context
    const getSeriesLabel = useMemo(() => {
      return (runName: string, metricName: string) => {
        if (isMultiMetric && isMultiRun) {
          return `${runName} \u00b7 ${metricName}`;
        }
        if (isMultiMetric) {
          return metricName;
        }
        return runName;
      };
    }, [isMultiMetric, isMultiRun]);

    // Memoize allData to prevent chart recreations on every render
    // For each metric×run pair: prefer standard data, fall back to preview
    const allData = useMemo(() => {
      return queryPairs
        .map((pair, index) => {
          const stdData = (queries[index]?.data ?? []) as MetricDataPoint[];
          if (stdData.length > 0) {
            return { data: stdData, isLoading: false, pair };
          }
          // Fall back to batch preview data for this metric×run
          const previewPoints =
            previewDataMap.get(pair.metric)?.[pair.line.runId];
          if (previewPoints && previewPoints.length > 0) {
            return { data: previewPoints, isLoading: queries[index]?.isLoading ?? true, pair };
          }
          return { data: [] as MetricDataPoint[], isLoading: queries[index]?.isLoading ?? true, pair };
        })
        .filter((item) => item.data.length > 0);
    }, [queries, queryPairs, previewDataMap]);

    // Also get custom log data if applicable - memoized
    const customLogData = useMemo(() => {
      return customLogQueries.map((query, index) => ({
        data: (query.data ?? []) as MetricDataPoint[],
        runId: lines[index]?.runId,
      }));
    }, [customLogQueries, lines]);

    const hasAnyData = allData.some((item) => item.data?.length > 0);
    const allQueriesDone = queries.every((query) => !query.isLoading);
    const allPreviewsDone = previewQueries.every((q) => !q.isLoading);

    // We're also loading if we're fetching custom log data
    const isLoadingCustomLogData =
      customLogQueries.length > 0 &&
      !customLogQueries.every((q) => q.data !== undefined);

    // Show loading spinner only if we have no data from either tier
    const isInitialLoading =
      !hasAnyData && ((!allQueriesDone && !allPreviewsDone) || isLoadingCustomLogData);

    // Memoize all chart data computations to prevent chart recreation on every render
    // IMPORTANT: This useMemo must be called BEFORE any early returns to maintain hook order
    const chartResult = useMemo(() => {
      // Return null for loading/empty states - will be handled by early returns below
      if (!hasAnyData) {
        return null;
      }

      // Helper to build series props from a query pair
      const seriesProps = (pair: typeof queryPairs[0]) => ({
        label: getSeriesLabel(pair.line.runName, pair.metric),
        seriesId: `${pair.line.runId}:${pair.metric}`,
        color: pair.line.color,
        dash: getDashPattern(pair.metricIndex),
      });

      // Collect raw (pre-downsampled) data for zoom-aware re-downsampling
      const rawLines: RawLineData[] = [];
      const collectRaw = settings.maxPointsPerSeries > 0;

      // System metrics chart - always uses relative time like in line-chart.tsx
      const isSystemChart = metricNames.every(
        (m) => m.startsWith("sys/") || m.startsWith("_sys/")
      );
      if (isSystemChart) {
        // Calculate the appropriate time unit across all datasets
        let unit = "s";
        let divisor = 1;
        if (allData.length > 0 && allData[0].data.length > 0) {
          // For each run, find the max time span
          const timeSpans = allData.map(({ data }) => {
            if (data.length < 2) return 0;
            const sortedData = [...data].sort(
              (a, b) => new Date(a.time).getTime() - new Date(b.time).getTime(),
            );
            const firstTime = new Date(sortedData[0].time).getTime();
            const lastTime = new Date(
              sortedData[sortedData.length - 1].time,
            ).getTime();
            return (lastTime - firstTime) / 1000; // time span in seconds
          });

          // Use the largest time span to determine the unit
          const maxTimeSpan = Math.max(...timeSpans);
          const timeUnit = getTimeUnitForDisplay(maxTimeSpan);
          unit = timeUnit.unit;
          divisor = timeUnit.divisor;
        }

        const chartData = allData
          .filter((item) => item.data.length > 0)
          .flatMap(({ data, pair }) => {
            const sortedData = [...data].sort(
              (a, b) => new Date(a.time).getTime() - new Date(b.time).getTime(),
            );

            // Calculate all time differences in seconds from the first data point
            const relativeTimes = sortedData.map(
              (d) =>
                (new Date(d.time).getTime() -
                  new Date(sortedData[0].time).getTime()) /
                1000,
            );

            // Convert all values to the selected unit using the consistent divisor
            const normalizedTimes = relativeTimes.map(
              (seconds) => seconds / divisor,
            );

            // Build valueFlags map for non-finite values
            let valueFlags: Map<number, string> | undefined;
            for (let i = 0; i < sortedData.length; i++) {
              const flag = (sortedData[i] as MetricDataPoint).valueFlag;
              if (flag && flag !== "") {
                if (!valueFlags) valueFlags = new Map();
                valueFlags.set(normalizedTimes[i], flag);
              }
            }

            const baseData = {
              x: normalizedTimes,
              y: sortedData.map((d: MetricDataPoint) => Number(d.value)),
              ...seriesProps(pair),
              valueFlags,
            };

            if (collectRaw) rawLines.push(baseData);
            return downsampleAndSmooth(baseData, settings.maxPointsPerSeries, settings.smoothing);
          });

        return {
          type: "system" as const,
          data: chartData,
          rawLines: collectRaw ? rawLines : undefined,
          xlabel: `relative time (${unit})`,
          isDateTime: false,
          className: "h-full min-h-96 w-full flex-grow",
        };
      }

      // Handle different chart types based on settings
      switch (settings.selectedLog) {
        case "Absolute Time": {
          const data = allData
            .filter((item) => item.data.length > 0)
            .flatMap(({ data, pair }) => {
              const baseData = {
                x: data.map((d: MetricDataPoint) => new Date(d.time).getTime()),
                y: data.map((d: MetricDataPoint) => Number(d.value)),
                ...seriesProps(pair),
                valueFlags: buildValueFlags(data, (d) => new Date(d.time).getTime()),
              };
              if (collectRaw) rawLines.push(baseData);
              return downsampleAndSmooth(baseData, settings.maxPointsPerSeries, settings.smoothing);
            });

          return {
            type: "data" as const,
            data,
            rawLines: collectRaw ? rawLines : undefined,
            xlabel: "absolute time",
            isDateTime: true,
            className: "h-full w-full",
          };
        }

        case "Relative Time": {
          const data = allData
            .filter((item) => item.data.length > 0)
            .flatMap(({ data, pair }) => {
              // Calculate relative times in seconds from first data point
              const firstTime = new Date(data[0].time).getTime();
              const relativeTimes = data.map(
                (d) => (new Date(d.time).getTime() - firstTime) / 1000,
              );

              // Determine appropriate time unit
              const maxSeconds = Math.max(...relativeTimes);
              const { divisor, unit } = getTimeUnitForDisplay(maxSeconds);

              // Convert to appropriate unit
              const normalizedTimes = relativeTimes.map(
                (seconds) => seconds / divisor,
              );

              // Build valueFlags map for non-finite values
              let valueFlags: Map<number, string> | undefined;
              for (let i = 0; i < data.length; i++) {
                const flag = (data[i] as MetricDataPoint).valueFlag;
                if (flag && flag !== "") {
                  if (!valueFlags) valueFlags = new Map();
                  valueFlags.set(normalizedTimes[i], flag);
                }
              }

              const baseData = {
                x: normalizedTimes,
                y: data.map((d: MetricDataPoint) => Number(d.value)),
                ...seriesProps(pair),
                valueFlags,
              };

              if (collectRaw) rawLines.push(baseData);
              return downsampleAndSmooth(baseData, settings.maxPointsPerSeries, settings.smoothing);
            });

          // Determine time unit from the first dataset
          const firstDataset = allData[0]?.data || [];
          const firstTime =
            firstDataset.length > 0
              ? new Date(firstDataset[0].time).getTime()
              : 0;
          const lastTime =
            firstDataset.length > 0
              ? new Date(firstDataset[firstDataset.length - 1].time).getTime()
              : 0;
          const maxSeconds = (lastTime - firstTime) / 1000;
          const { unit } = getTimeUnitForDisplay(maxSeconds);

          return {
            type: "data" as const,
            data,
            rawLines: collectRaw ? rawLines : undefined,
            xlabel: `relative time (${unit})`,
            isDateTime: false,
            className: "h-full w-full",
          };
        }

        case "Step": {
          // Default step-based chart
          // Priority: zoom refetch data > standard data
          const data = allData
            .filter((item) => item.data.length > 0)
            .flatMap(({ data: tierData, pair }) => {
              const key = zoomKey(pair.line.runId, pair.metric);
              const isUsingZoomData = zoomDataMap?.has(key) ?? false;
              const sourceData = (isUsingZoomData ? zoomDataMap?.get(key) : undefined) ?? tierData;
              const baseData = {
                x: sourceData.map((d: MetricDataPoint) => Number(d.step)),
                y: sourceData.map((d: MetricDataPoint) => Number(d.value)),
                ...seriesProps(pair),
                valueFlags: buildValueFlags(sourceData, (d) => Number(d.step)),
              };
              if (collectRaw) rawLines.push(baseData);
              // Skip client-side downsampling for zoom data — it's already
              // range-limited by the server query, so downsampling would
              // re-introduce step gaps that the zoom refetch was meant to fill.
              const effectiveMaxPoints = isUsingZoomData ? 0 : settings.maxPointsPerSeries;
              return downsampleAndSmooth(baseData, effectiveMaxPoints, settings.smoothing);
            });

          return {
            type: "data" as const,
            data,
            rawLines: collectRaw ? rawLines : undefined,
            xlabel,
            isDateTime: false,
            className: "h-full w-full",
          };
        }

        default: {
          // Custom selected log chart - use the selected log for x-axis values
          if (customLogData.length === 0) {
            return {
              type: "error" as const,
              errorType: "no-custom-data" as const,
            };
          }

          // Match up x values (selected log) with y values (current log)
          const validChartData: {
            pair: typeof queryPairs[0];
            alignedData: { x: number[]; y: number[] } | null;
          }[] = allData
            .filter((item) => item.data.length > 0)
            .map(({ data, pair }) => {
              // Find matching custom log data for this run
              const matchingXData = customLogData.find(
                (d) => d.runId === pair.line.runId,
              )?.data;

              if (!matchingXData || matchingXData.length === 0) {
                return { pair, alignedData: null };
              }

              // Align and unzip x and y data
              const alignedData = alignAndUnzip(matchingXData, data);

              if (alignedData.x.length === 0 || alignedData.y.length === 0) {
                return { pair, alignedData: null };
              }

              return { pair, alignedData };
            });

          // Check if we have any valid data to show
          const hasValidData = validChartData.some(
            (item) => item.alignedData !== null,
          );

          if (!hasValidData) {
            return {
              type: "error" as const,
              errorType: "no-valid-data" as const,
            };
          }

          // Create chart data from valid comparisons
          const data = validChartData
            .filter((item) => item.alignedData !== null)
            .flatMap(({ pair, alignedData }) => {
              const baseData = {
                x: alignedData!.x,
                y: alignedData!.y,
                ...seriesProps(pair),
              };
              if (collectRaw) rawLines.push(baseData);
              return downsampleAndSmooth(baseData, settings.maxPointsPerSeries, settings.smoothing);
            });

          return {
            type: "data" as const,
            data,
            rawLines: collectRaw ? rawLines : undefined,
            xlabel: settings.selectedLog,
            isDateTime: false,
            className: "h-full w-full",
          };
        }
      }
    }, [allData, customLogData, settings, title, xlabel, hasAnyData, queryPairs, getSeriesLabel, zoomDataMap]);

    // Callback for zoom-aware re-downsampling: slices raw data to visible range
    // and runs the full downsample+smooth pipeline to produce consistent series structure.
    // Stored in a ref inside the chart component, so reference instability is fine.
    const reprocessForZoom = useMemo(() => {
      if (settings.maxPointsPerSeries <= 0) return undefined;
      const smoothing = settings.smoothing;
      return (raws: RawLineData[], xMin: number, xMax: number) => {
        return raws.flatMap((raw) => {
          // Find visible range with 1-point margin on each side
          let startIdx = 0;
          let endIdx = raw.x.length;
          for (let j = 0; j < raw.x.length; j++) {
            if (raw.x[j] >= xMin) { startIdx = Math.max(0, j - 1); break; }
          }
          for (let j = raw.x.length - 1; j >= 0; j--) {
            if (raw.x[j] <= xMax) { endIdx = Math.min(raw.x.length, j + 2); break; }
          }
          const sliced = {
            x: raw.x.slice(startIdx, endIdx),
            y: raw.y.slice(startIdx, endIdx),
            label: raw.label,
            seriesId: raw.seriesId,
            color: raw.color,
            dash: raw.dash,
          };
          // Use maxPts=0: show ALL raw data points in the visible range.
          // applyDownsampling always produces 3 series (main + envelope),
          // matching the initial render's series count for setData compatibility.
          return downsampleAndSmooth(sliced, 0, smoothing);
        });
      };
    }, [settings.maxPointsPerSeries, settings.smoothing]);

    // Too many series warning
    if (tooManySeries) {
      return (
        <div className="flex h-full w-full flex-grow flex-col items-center justify-center bg-accent/50 p-4">
          <p className="text-sm font-medium text-foreground">{title}</p>
          <p className="mt-2 text-center text-sm text-muted-foreground">
            Too many series ({queryPairs.length}). Maximum is {MAX_SERIES_COUNT}.
          </p>
          <p className="text-center text-xs text-muted-foreground">
            Reduce the number of selected runs or metrics.
          </p>
        </div>
      );
    }

    // Error state
    if (isError) {
      return (
        <div className="flex h-full w-full flex-grow flex-col items-center justify-center bg-red-500">
          <h2 className="text-2xl font-bold">{title}</h2>
          <p className="text-sm text-gray-200">Error fetching data</p>
        </div>
      );
    }

    // Initial loading state - show metric title and series names while loading
    if (isInitialLoading) {
      return (
        <div className="relative flex h-full w-full flex-grow flex-col bg-accent/50">
          {/* Title */}
          <div className="p-3 text-center">
            <h3 className="text-lg font-semibold text-foreground">{title}</h3>
          </div>
          {/* Series/run names being loaded */}
          <div className="flex-1 overflow-hidden px-4 pb-4">
            <div className="flex flex-wrap gap-2">
              {lines.slice(0, 10).map((line) => (
                <div
                  key={line.runId}
                  className="flex items-center gap-1.5 rounded-md bg-muted/50 px-2 py-1 text-xs"
                >
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ backgroundColor: line.color }}
                  />
                  <span className="max-w-[120px] truncate text-muted-foreground">
                    {line.runName}
                  </span>
                </div>
              ))}
              {lines.length > 10 && (
                <div className="rounded-md bg-muted/50 px-2 py-1 text-xs text-muted-foreground">
                  +{lines.length - 10} more
                </div>
              )}
            </div>
          </div>
          {/* Loading spinner overlay */}
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-primary" />
          </div>
        </div>
      );
    }

    // Empty state - only if we have no data and all queries (standard + preview) are done
    if (allQueriesDone && allPreviewsDone && !hasAnyData) {
      return (
        <div className="flex h-full w-full flex-grow flex-col items-center justify-center bg-accent">
          <h2 className="text-2xl font-bold">{title}</h2>
          <p className="text-sm text-gray-500">No data received yet</p>
        </div>
      );
    }

    // Handle error cases from chart data computation
    if (!chartResult || chartResult.type === "error") {
      return (
        <div className="flex h-full flex-grow flex-col items-center justify-center bg-accent p-4">
          <p className="text-center text-sm text-gray-500">
            Could not compare{" "}
            <code className="rounded bg-muted px-1">{title}</code> with{" "}
            <code className="rounded bg-muted px-1">
              {settings.selectedLog}
            </code>
          </p>
        </div>
      );
    }

    // Render the chart with memoized data
    return (
      <div className="relative h-full w-full">
        {/* Zoom refetch loading indicator */}
        {isZoomFetching && (
          <div className="absolute top-0 right-0 left-0 z-10 h-0.5 overflow-hidden bg-muted">
            <div className="h-full w-1/3 animate-[shimmer_1s_ease-in-out_infinite] bg-primary" />
          </div>
        )}
        <LineChart
          lines={chartResult.data}
          className={chartResult.className}
          title={title}
          xlabel={chartResult.xlabel}
          showLegend={true}
          isDateTime={chartResult.isDateTime}
          logXAxis={logXAxis}
          logYAxis={logYAxis}
          yMin={yMin}
          yMax={yMax}
          onDataRange={onDataRange}
          onResetBounds={onResetBounds}
          tooltipInterpolation={settings.tooltipInterpolation}
          outlierDetection={settings.yAxisScaleMode === "outlier-aware"}
          rawLines={chartResult.rawLines}
          downsampleTarget={settings.maxPointsPerSeries}
          reprocessForZoom={reprocessForZoom}
          onZoomRangeChange={onZoomRangeChange}
        />
      </div>
    );
  },
);
