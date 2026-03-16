"use client";

import { default as LineChart } from "@/components/charts/line-wrapper";
import { memo, useEffect, useMemo } from "react";
import { useQueries, keepPreviousData } from "@tanstack/react-query";
import { trpc, trpcClient } from "@/utils/trpc";
import { useCheckDatabaseSize } from "@/lib/db/local-cache";
import { bucketedMetricsCache, metricsCache, type MetricDataPoint } from "@/lib/db/index";
import type { BucketedChartDataPoint, ChartSeriesData } from "@/lib/chart-data-utils";
import { useLocalQueries } from "@/lib/hooks/use-local-query";
import { useLineSettings, type DisplayLogName } from "@/routes/o.$orgSlug._authed/(run)/projects.$projectName.$runId/~components/use-line-settings";
import { useZoomRefetch, zoomKey } from "@/lib/hooks/use-zoom-refetch";
import { useChartColors } from "@/components/ui/color-picker";
import { useChartSyncContext } from "@/components/charts/context/chart-sync-context";
import {
  alignAndUnzip,
  applySmoothing,
  bucketedAndSmooth,
} from "@/lib/chart-data-utils";
import { estimateStandardBuckets, PREVIEW_BUCKETS } from "@/lib/chart-bucket-estimate";
import { parseChTimeMs } from "@/components/charts/lib/format";

// For active runs, refresh every 30 seconds
// For completed runs, data never changes so use Infinity
const ACTIVE_RUN_STALE_TIME = 30 * 1000; // 30 seconds
const COMPLETED_RUN_STALE_TIME = Infinity; // Never refetch completed runs
const GC_TIME = 0; // Immediate garbage collection when query is inactive

// Maximum number of series (metrics × runs) before showing a warning
const MAX_SERIES_COUNT = 200;

/** Distinct dash patterns per metric index (metric 0 = solid). */
// Base dash patterns for multi-metric charts. Values are horizontal pixel
// distances (on, off, ...). For dense data, series-config.ts uses a custom
// paths builder that renders these as horizontal-distance dashes with
// subsampled points for noise reduction.
const METRIC_DASH_PATTERNS: (number[] | undefined)[] = [
  undefined,              // metric 0: solid           ━━━━━━━━━
  [16, 10],              // metric 1: dashed          ━  ━  ━  ━
  [4, 10],               // metric 2: dotted          · · · · · ·
  [16, 6, 4, 6],         // metric 3: dash-dot        ━ · ━ · ━ ·
  [24, 8, 4, 8],         // metric 4: long dash-dot   ━━ · ━━ · ━━
  [16, 6, 4, 6, 4, 6],   // metric 5: dash-dot-dot    ━ · · ━ · ·
  [30, 14],              // metric 6: long dash       ━━━  ━━━  ━━━
  [10, 10],              // metric 7: short dash      ━ ━ ━ ━ ━ ━
  [30, 8, 10, 8],        // metric 8: long-short      ━━━ ━ ━━━ ━
  [4, 10, 4, 10, 16, 10], // metric 9: dot-dot-dash    · · ━ · · ━
];

function getDashPattern(metricIndex: number): number[] | undefined {
  if (metricIndex < METRIC_DASH_PATTERNS.length) {
    return METRIC_DASH_PATTERNS[metricIndex];
  }
  // For 10+ metrics, cycle through patterns 1-9 (skip solid)
  return METRIC_DASH_PATTERNS[((metricIndex - 1) % 9) + 1];
}

interface MultiLineChartProps {
  lines: {
    runId: string;
    runName: string;
    rawRunName?: string;
    color: string;
    createdAt?: string;
    displayId?: string | null;
  }[];
  title: string;
  /** Subtitle shown in tooltip header (e.g. chip/pattern names) */
  subtitle?: string;
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
  /** Override x-axis mode (per-widget config takes precedence over global line settings).
   *  Values: "Step", "Absolute Time", "Relative Time", or a custom metric name. */
  xAxisOverride?: DisplayLogName;
  /** When provided, reads line settings from this runId instead of the "full" key */
  settingsRunId?: string;
}

/** Props for the inner memo'd component (includes syncedZoomRange) */
interface MultiLineChartInnerProps extends MultiLineChartProps {
  syncedZoomRange: [number, number] | null;
  syncedZoomGroup: string | null;
  /** Chart sync context for clearing stale state */
  chartSyncContext: ReturnType<typeof useChartSyncContext>;
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
  const syncedZoomGroup = chartSyncContext?.syncedZoomGroupRef?.current ?? null;
  return <MultiLineChartInner {...props} syncedZoomRange={syncedZoomRange} syncedZoomGroup={syncedZoomGroup} chartSyncContext={chartSyncContext} />;
}

const MultiLineChartInner = memo(
  ({
    lines,
    title,
    subtitle,
    metrics: metricsProp,
    xlabel,
    organizationId,
    projectName,
    allRunsCompleted = false,
    yMin,
    yMax,
    onDataRange,
    onResetBounds,
    syncedZoomRange: syncedZoomRangeRaw,
    syncedZoomGroup,
    chartSyncContext,
    logXAxis: logXAxisOverride,
    logYAxis: logYAxisOverride,
    xAxisOverride,
    settingsRunId,
  }: MultiLineChartInnerProps) => {
    useCheckDatabaseSize(bucketedMetricsCache);
    const chartColors = useChartColors();

    // Compute once on mount — changing bucket count changes query key, so avoid recomputing
    const standardBuckets = useMemo(() => estimateStandardBuckets(), []);

    // Resolve metrics list: use prop if provided, otherwise fall back to [title]
    const metricNames = useMemo(
      () => metricsProp ?? [title],
      [metricsProp, title],
    );
    const isMultiMetric = metricNames.length > 1;
    const isMultiRun = lines.length > 1;

    // Use run-specific settings when available, otherwise fall back to "full"
    const { settings } = useLineSettings(organizationId, projectName, settingsRunId ?? "full");

    // Cross-axis zoom sync (step ↔ relative time) is only enabled in the
    // single-run dashboard view. settingsRunId is a real run ID only there;
    // in the multi-run comparison view it's undefined.
    const isSingleRunDashboard = !!settingsRunId;

    // Per-widget overrides take precedence over global settings
    const logXAxis = logXAxisOverride ?? settings.xAxisLogScale;
    const logYAxis = logYAxisOverride ?? settings.yAxisLogScale;
    const effectiveXAxis: DisplayLogName = xAxisOverride ?? settings.selectedLog;

    // Resolve synced zoom range for this chart's axis type.
    // Multi-run comparison: only sync within the same zoom group.
    // Single-run dashboard: also support cross-axis sync via crossGroupZoomRef.
    const myZoomGroup = effectiveXAxis === "Relative Time" ? "relative-time" : (effectiveXAxis === "Step" ? "step" : "default");
    const syncedZoomRange = useMemo(() => {
      // Same group: use directly
      if (syncedZoomGroup === myZoomGroup) return syncedZoomRangeRaw;

      // Cross-group: only in single-run dashboard
      if (isSingleRunDashboard) {
        const cross = chartSyncContext?.crossGroupZoomRef?.current;
        if (cross && cross.group === myZoomGroup) return cross.range;
      }

      return null;
    }, [syncedZoomRangeRaw, syncedZoomGroup, myZoomGroup, isSingleRunDashboard, chartSyncContext?.syncedZoomRange]);

    // Extract original step bounds from cross-axis zoom to skip lossy roundtrip.
    // Only in single-run dashboard — multi-run comparison doesn't support cross-axis zoom.
    const sourceStepRange = useMemo(() => {
      if (!isSingleRunDashboard) return null;
      const cross = chartSyncContext?.crossGroupZoomRef?.current;
      const isRelTime = effectiveXAxis === "Relative Time";
      if (isRelTime && cross?.group === "relative-time" && cross.sourceStepRange) {
        return cross.sourceStepRange;
      }
      return null;
    }, [isSingleRunDashboard, chartSyncContext?.syncedZoomRange, effectiveXAxis]);

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

    const runIds = useMemo(() => lines.map((l) => l.runId), [lines]);

    // === Standard tier: 1 batch query per metric for all runs (globally aligned buckets) ===
    const standardBatchQueries = useQueries({
      queries: tooManySeries
        ? []
        : metricNames.map((metric) => {
            const opts = {
              organizationId,
              projectName,
              logName: metric,
              runIds,
              buckets: standardBuckets,
            };
            return {
              queryKey: trpc.runs.data.graphBatchBucketed.queryOptions(opts).queryKey,
              queryFn: () => trpcClient.runs.data.graphBatchBucketed.query(opts),
              staleTime,
              gcTime: GC_TIME,
              placeholderData: keepPreviousData,
              enabled: runIds.length > 0,
            };
          }),
    });

    // Build a lookup: metric → runId → standard bucketed points
    const standardDataMap = useMemo(() => {
      const map = new Map<string, Record<string, BucketedChartDataPoint[]>>();
      metricNames.forEach((metric, i) => {
        const data = standardBatchQueries[i]?.data as
          | Record<string, BucketedChartDataPoint[]>
          | undefined;
        if (data) {
          map.set(metric, data);
        }
      });
      return map;
    }, [metricNames, standardBatchQueries]);

    // === Batch preview tier: 1 query per metric for all runs (fast bucketed) ===
    // Provides instant chart shapes while individual standard queries load.
    // Disabled once any standard data arrives (preview is lower resolution).
    const hasAnyStandard = standardBatchQueries.some(
      (q) => q.data !== undefined && Object.keys(q.data as Record<string, unknown>).length > 0,
    );

    const previewQueries = useQueries({
      queries: tooManySeries
        ? []
        : metricNames.map((metric) => {
            const opts = {
              organizationId,
              projectName,
              logName: metric,
              runIds,
              buckets: PREVIEW_BUCKETS,
              preview: true,
            };
            return {
              queryKey: [
                ...trpc.runs.data.graphBatchBucketed.queryOptions(opts).queryKey,
                "preview",
              ],
              queryFn: () => trpcClient.runs.data.graphBatchBucketed.query(opts),
              staleTime: Infinity,
              gcTime: 0,
              enabled: runIds.length > 0 && !hasAnyStandard,
            };
          }),
    });

    // Build a lookup: metric → runId → preview points
    const previewDataMap = useMemo(() => {
      const map = new Map<string, Record<string, BucketedChartDataPoint[]>>();
      metricNames.forEach((metric, i) => {
        const data = previewQueries[i]?.data as
          | Record<string, BucketedChartDataPoint[]>
          | undefined;
        if (data) {
          map.set(metric, data);
        }
      });
      return map;
    }, [metricNames, previewQueries]);

    // If the effective x-axis is not a standard one, fetch that data for each run
    // to use as x-axis values (only need one per run, not per metric)
    // Custom log queries still use raw graph endpoint for step-level alignment
    const customLogQueries = useLocalQueries<MetricDataPoint>(
      effectiveXAxis !== "Step" &&
        effectiveXAxis !== "Absolute Time" &&
        effectiveXAxis !== "Relative Time"
        ? lines.map((line) => {
            const opts = {
              organizationId,
              projectName,
              runId: line.runId,
              logName: effectiveXAxis,
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

    // Compute per-run baselines for relative time: use run.createdAt when
    // available, falling back to the first data point's timestamp.
    const runBaselineMap = useMemo(() => {
      const map = new Map<string, number>();
      const firstMetricData = standardDataMap.values().next().value as
        | Record<string, BucketedChartDataPoint[]>
        | undefined;
      if (!firstMetricData) return map;
      for (const line of lines) {
        const points = firstMetricData[line.runId];
        if (!points || points.length === 0) continue;
        const sorted = [...points].sort(
          (a, b) => parseChTimeMs(a.time) - parseChTimeMs(b.time),
        );
        const firstPointMs = parseChTimeMs(sorted[0].time);
        if (line.createdAt) {
          map.set(line.runId, new Date(line.createdAt).getTime());
        } else {
          map.set(line.runId, firstPointMs);
        }
      }
      return map;
    }, [standardDataMap, lines]);

    // Build time→step mapping from bucketed data for relative-time zoom refetch.
    // Uses the corrected baseline (same as Relative Time chart data preparation).
    const timeStepMapping = useMemo(() => {
      if (effectiveXAxis !== "Relative Time") return null;
      const map = new Map<string, { relTimeSecs: number[]; steps: number[] }>();
      const firstMetricData = standardDataMap.values().next().value as
        | Record<string, BucketedChartDataPoint[]>
        | undefined;
      if (!firstMetricData) return null;
      for (const line of lines) {
        const points = firstMetricData[line.runId];
        if (!points || points.length === 0) continue;
        const sorted = [...points].sort((a, b) => a.step - b.step);
        const baselineMs = runBaselineMap.get(line.runId)
          ?? parseChTimeMs(sorted[0].time);
        const relTimeSecs = sorted.map(
          (d) => (parseChTimeMs(d.time) - baselineMs) / 1000,
        );
        const steps = sorted.map((d) => d.step);
        map.set(line.runId, { relTimeSecs, steps });
      }
      return map.size > 0 ? map : null;
    }, [effectiveXAxis, standardDataMap, lines, runBaselineMap]);

    // Cross-axis zoom sync: register step↔time mapping for single-run dashboards
    // so zooming a Step widget syncs to Relative Time widgets (and vice versa).
    // For multi-run, clear any stale mapping — different runs can have different
    // step↔time relationships, making cross-axis translation unreliable.
    // NOTE: Do NOT clear syncedZoomRange here — in dashboards with mixed
    // Step/RelTime widgets, each widget's effect would race to clear the
    // zoom set by another widget in the same group.
    useEffect(() => {
      if (!chartSyncContext) return;
      if (!isSingleRunDashboard) {
        // Multi-run comparison: clear mapping to prevent cross-axis zoom
        chartSyncContext.stepTimeMappingRef.current = null;
        chartSyncContext.crossGroupZoomRef.current = null;
      } else {
        // Single-run dashboard: register mapping if not already set
        if (!chartSyncContext.stepTimeMappingRef.current) {
          const firstMetricData = standardDataMap.values().next().value as
            | Record<string, BucketedChartDataPoint[]>
            | undefined;
          const runId = lines[0]?.runId;
          const points = runId ? firstMetricData?.[runId] : undefined;
          if (points && points.length > 0) {
            const sorted = [...points].sort((a, b) => a.step - b.step);
            const baselineMs = runBaselineMap.get(runId!)
              ?? parseChTimeMs(sorted[0].time);
            const steps = sorted.map((d) => d.step);
            const relTimeSecs = sorted.map(
              (d) => (parseChTimeMs(d.time) - baselineMs) / 1000,
            );
            chartSyncContext.setStepTimeMapping(steps, relTimeSecs);
          }
        }
      }
    }, [chartSyncContext, isSingleRunDashboard, standardDataMap, lines, runBaselineMap]);

    // Zoom-triggered server re-fetch using bucketed downsampling
    const { zoomDataMap, onZoomRangeChange, isZoomFetching } = useZoomRefetch({
      organizationId,
      projectName,
      logNames: metricNames,
      runIds,
      selectedLog: effectiveXAxis,
      staleTime,
      syncedZoomRange,
      sourceStepRange,
      timeStepMapping,
    });

    // Check error states and get data
    const isError = standardBatchQueries.some((query) => query.isError);

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
        .map((pair) => {
          const stdPoints = standardDataMap.get(pair.metric)?.[pair.line.runId];
          if (stdPoints && stdPoints.length > 0) {
            return { data: stdPoints, isLoading: false, pair };
          }
          // Fall back to batch preview data for this metric×run
          const previewPoints =
            previewDataMap.get(pair.metric)?.[pair.line.runId];
          if (previewPoints && previewPoints.length > 0) {
            return { data: previewPoints, isLoading: !hasAnyStandard, pair };
          }
          return { data: [] as BucketedChartDataPoint[], isLoading: !hasAnyStandard, pair };
        })
        .filter((item) => item.data.length > 0);
    }, [standardDataMap, queryPairs, previewDataMap, hasAnyStandard]);

    // Also get custom log data if applicable - memoized
    const customLogData = useMemo(() => {
      return customLogQueries.map((query, index) => ({
        data: (query.data ?? []) as MetricDataPoint[],
        runId: lines[index]?.runId,
      }));
    }, [customLogQueries, lines]);

    const hasAnyData = allData.some((item) => item.data?.length > 0);
    const allQueriesDone = standardBatchQueries.every((query) => !query.isLoading);
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

      // Use the corrected per-run baselines computed above. These use createdAt
      // when it's close to the first data point, falling back to first data point
      // time when createdAt is too far ahead.

      // Helper to build series props from a query pair.
      // Single-run multi-metric: prefer color variation (more visually distinct)
      // over dash patterns. Multi-run: keep run color with dash per metric.
      const seriesProps = (pair: typeof queryPairs[0]) => {
        const useSingleRunColors = !isMultiRun && isMultiMetric;

        // Color-major ordering for single-run multi-metric: cycle through all
        // palette colors (solid) first, then repeat colors with dash pattern 1,
        // then dash pattern 2, etc.
        const paletteSize = chartColors.length;
        const colorIndex = pair.metricIndex % paletteSize;
        const dashCycle = Math.floor(pair.metricIndex / paletteSize);

        return {
          label: getSeriesLabel(pair.line.runName, pair.metric),
          seriesId: `${pair.line.runId}:${pair.metric}`,
          color: useSingleRunColors
            ? chartColors[colorIndex]
            : pair.line.color,
          dash: useSingleRunColors
            ? (dashCycle === 0 ? undefined : METRIC_DASH_PATTERNS[((dashCycle - 1) % 9) + 1])
            : getDashPattern(pair.metricIndex),
          rawRunName: pair.line.rawRunName ?? pair.line.runName,
          displayId: pair.line.displayId ?? null,
          metricName: pair.metric,
        };
      };

      /** Inject tooltip metadata into series returned by bucketedAndSmooth */
      const withMeta = (series: ChartSeriesData[], props: ReturnType<typeof seriesProps>): ChartSeriesData[] =>
        series.map((s) => ({
          ...s,
          runName: props.rawRunName,
          runId: props.displayId ?? undefined,
          metricName: props.metricName,
        }));

      // System metrics chart - always uses relative time like in line-chart.tsx
      const isSystemChart = metricNames.every(
        (m) => m.startsWith("sys/") || m.startsWith("_sys/")
      );
      if (isSystemChart) {
        // Keep x-values in raw seconds — the axis formatter picks display units
        // dynamically based on the visible range. This ensures system charts use
        // the same numeric scale as regular relative time charts for zoom sync.
        const chartData = allData
          .filter((item) => item.data.length > 0)
          .flatMap(({ data, pair }) => {
            const sortedData = [...data].sort(
              (a, b) => parseChTimeMs(a.time) - parseChTimeMs(b.time),
            );
            const props = seriesProps(pair);
            // Use run.createdAt as baseline when available, falling back to first data point
            const baselineMs = runBaselineMap.get(pair.line.runId)
              ?? parseChTimeMs(sortedData[0].time);
            const getX = (d: BucketedChartDataPoint) =>
              (parseChTimeMs(d.time) - baselineMs) / 1000;

            return withMeta(bucketedAndSmooth(
              sortedData, props.label, props.color,
              settings.smoothing, isMultiMetric, props.seriesId, props.dash, getX,
            ), props);
          });

        return {
          type: "system" as const,
          data: chartData,
          xlabel: "relative time",
          isDateTime: false,
          className: "h-full min-h-96 w-full flex-grow",
        };
      }

      // Handle different chart types based on effective x-axis
      switch (effectiveXAxis) {
        case "Absolute Time": {
          const data = allData
            .filter((item) => item.data.length > 0)
            .flatMap(({ data, pair }) => {
              const props = seriesProps(pair);
              const getX = (d: BucketedChartDataPoint) => parseChTimeMs(d.time);
              return withMeta(bucketedAndSmooth(
                data, props.label, props.color,
                settings.smoothing, isMultiMetric, props.seriesId, props.dash, getX,
              ), props);
            });

          return {
            type: "data" as const,
            data,
            xlabel: "absolute time",
            isDateTime: true,
            className: "h-full w-full",
          };
        }

        case "Relative Time": {
          // Keep x-values in seconds — the axis formatter picks display units
          // dynamically based on the visible range. This ensures all relative
          // time charts (including system charts) share the same numeric scale
          // and can sync zoom correctly.
          // Priority: zoom refetch data > standard data (same as Step mode)
          const data = allData
            .filter((item) => item.data.length > 0)
            .flatMap(({ data: tierData, pair }) => {
              const key = zoomKey(pair.line.runId, pair.metric);
              const zoomData = zoomDataMap?.get(key);
              const sourceData = zoomData ?? tierData;
              // Use run.createdAt as the baseline when available, falling back to
              // the first point of the STANDARD (full-range) data — NOT sourceData,
              // which may be zoom-refetched and would shift the baseline to 0.
              const baselineMs = runBaselineMap.get(pair.line.runId)
                ?? parseChTimeMs(tierData[0].time);
              const props = seriesProps(pair);
              const getX = (d: BucketedChartDataPoint) =>
                (parseChTimeMs(d.time) - baselineMs) / 1000;

              return withMeta(bucketedAndSmooth(
                sourceData, props.label, props.color,
                settings.smoothing, isMultiMetric, props.seriesId, props.dash, getX,
              ), props);
            });

          return {
            type: "data" as const,
            data,
            xlabel: "relative time",
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
              const zoomData = zoomDataMap?.get(key);
              const sourceData = zoomData ?? tierData;
              const props = seriesProps(pair);

              return withMeta(bucketedAndSmooth(
                sourceData, props.label, props.color,
                settings.smoothing, isMultiMetric, props.seriesId, props.dash,
              ), props);
            });

          return {
            type: "data" as const,
            data,
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
          // Bucketed data has representative steps — alignment still works
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

              // Convert bucketed data to ChartDataPoint for alignment
              const yData = data.map((d) => ({
                step: d.step,
                time: d.time,
                value: d.value,
              }));

              const alignedData = alignAndUnzip(matchingXData, yData);

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
          // Custom log axes can't use server envelopes — apply smoothing only
          const data = validChartData
            .filter((item) => item.alignedData !== null)
            .flatMap(({ pair, alignedData }) => {
              const props = seriesProps(pair);
              const baseData = {
                x: alignedData!.x,
                y: alignedData!.y,
                ...props,
              };
              return applySmoothing(baseData, settings.smoothing, isMultiMetric);
            });

          return {
            type: "data" as const,
            data,
            xlabel: effectiveXAxis,
            isDateTime: false,
            className: "h-full w-full",
          };
        }
      }
    }, [allData, customLogData, settings, effectiveXAxis, title, xlabel, hasAnyData, queryPairs, getSeriesLabel, zoomDataMap, isMultiMetric, isMultiRun, chartColors, metricNames, lines, runBaselineMap]);

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
              {effectiveXAxis}
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
          subtitle={subtitle}
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
          spanGaps={!settings.skipMissingValues}
          onZoomRangeChange={onZoomRangeChange}
        />
      </div>
    );
  },
);
