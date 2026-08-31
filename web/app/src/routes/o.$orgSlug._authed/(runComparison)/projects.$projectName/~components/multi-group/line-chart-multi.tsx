"use client";

import { default as LineChart } from "@/components/charts/line-wrapper";
import { ChartLoadingSkeleton } from "@/components/charts/chart-loading-skeleton";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { computeExperimentSegments } from "@/lib/experiment-data-utils";
import { useQueries, useQuery, keepPreviousData } from "@tanstack/react-query";
import { trpc, trpcClient } from "@/utils/trpc";
import { useCheckDatabaseSize } from "@/lib/db/local-cache";
import { bucketedMetricsCache, metricsCache, type MetricDataPoint } from "@/lib/db/index";
import type { BucketedChartDataPoint, ChartSeriesData } from "@/lib/chart-data-utils";
import { useLocalQueries } from "@/lib/hooks/use-local-query";
import { useLineSettings, DEFAULT_SETTINGS, type DisplayLogName } from "@/routes/o.$orgSlug._authed/(run)/projects.$projectName.$runId/~components/use-line-settings";
import { useZoomRefetch, zoomKey } from "@/lib/hooks/use-zoom-refetch";
import { useChartColors } from "@/components/ui/color-picker";
import { useChartSyncContext } from "@/components/charts/context/chart-sync-context";
import {
  applySmoothing,
  bucketedAndSmooth,
  fromColumnar,
  MULTI_METRIC_CHUNK,
  chunkArray,
  splitMonotonicLegs,
  envelopeSeries,
  type ColumnarBucketedSeries,
  type ColumnarParametricSeries,
} from "@/lib/chart-data-utils";
import { resolveChartBuckets } from "@/lib/chart-bucket-estimate";
import { parseChTimeMs } from "@/components/charts/lib/format";
import { getDashPattern } from "./metric-dash";
import { WidgetLimitNotice } from "@/components/shared/widget-limit-notice";
import { MAX_RUNS_PER_BATCH, resolveChartLimit } from "@/lib/batch-limits";

// For active runs, refresh every 30 seconds
// For completed runs, data never changes so use Infinity
const ACTIVE_RUN_STALE_TIME = 30 * 1000; // 30 seconds
const COMPLETED_RUN_STALE_TIME = Infinity; // Never refetch completed runs
const GC_TIME = 0; // Immediate garbage collection when query is inactive


interface MultiLineChartProps {
  lines: {
    runId: string;
    runName: string;
    rawRunName?: string;
    color: string;
    createdAt?: string;
    displayId?: string | null;
    forkStep?: number | null;
    forkedFromRunId?: string | null;
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
  /** Override log X-axis scale (per-widget config takes precedence over global settings) */
  logXAxis?: boolean;
  /** Override log Y-axis scale (per-widget config takes precedence over global settings) */
  logYAxis?: boolean;
  /** Externally-stored Y zoom range for persistence across mini/fullscreen */
  yZoomRange?: [number, number] | null;
  /** Called when user drags to zoom Y axis, or null on reset */
  onYZoomRangeChange?: (range: [number, number] | null) => void;
  /** Override x-axis mode (per-widget config takes precedence over global line settings).
   *  Values: "Step", "Absolute Time", "Relative Time", or a custom metric name. */
  xAxisOverride?: DisplayLogName;
  /** When provided, reads line settings from this runId instead of the "full" key */
  settingsRunId?: string;
  /** Extra left padding to push the plot area inward. Used by
   *  chart-widget when a transposed bars panel sits below — passing
   *  the bars panel's bin-label gutter width here makes the X-axis
   *  ticks line up end-to-end across both canvases. */
  extraLeftPadding?: number;
  /** Extra right padding mirror. Pins the line chart's right edge to a
   *  known offset matching the bars chart's rightMargin. */
  extraRightPadding?: number;
  /**
   * Replaces the over-limit notice's remedy line.
   *
   * The default tells the user to reduce their selection, which is only
   * actionable where there IS one. On the sweep page the run set is the
   * sweep's membership — fixed — so that advice sends them looking for a
   * control that does not exist.
   */
  limitHint?: string;
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
    syncedZoomRange: syncedZoomRangeRaw,
    syncedZoomGroup,
    chartSyncContext,
    logXAxis: logXAxisOverride,
    logYAxis: logYAxisOverride,
    yZoomRange,
    onYZoomRangeChange,
    xAxisOverride,
    settingsRunId,
    extraLeftPadding,
    extraRightPadding,
    limitHint,
  }: MultiLineChartInnerProps) => {
    useCheckDatabaseSize(bucketedMetricsCache);
    const chartColors = useChartColors();

    // Resolve metrics list: use prop if provided, otherwise fall back to [title]
    const metricNames = useMemo(
      () => metricsProp ?? [title],
      [metricsProp, title],
    );
    const isMultiMetric = metricNames.length > 1;
    const isMultiRun = lines.length > 1;

    // Use run-specific settings when available, otherwise fall back to "full"
    const { settings } = useLineSettings(organizationId, projectName, settingsRunId ?? "full");

    // Read view settings from URL params, falling back to persisted settings.
    const urlParams = typeof window !== "undefined"
      ? new URLSearchParams(window.location.search) : null;
    const isExperimentsMode = urlParams?.get("listMode") === "experiments";
    // In experiments mode, enable lineage so forks inherit parent data to fill gaps.
    // The experiment segment filter will then truncate each run to its exclusive range.
    const showInheritedMetrics = isExperimentsMode ? true : (() => {
      const v = urlParams?.get("inherited");
      if (v === "true") return true;
      if (v === "false") return false;
      return settings.showInheritedMetrics;
    })();

    // Build forkSteps map for chart annotations (runId → forkStep)
    const forkSteps = useMemo(() => {
      const map = new Map<string, number>();
      for (const line of lines) {
        if (line.forkStep != null) {
          map.set(line.runId, line.forkStep);
        }
      }
      return map;
    }, [lines]);

    // Resolve bucket count from user settings — auto mode boosts when smoothing is off
    const standardBuckets = useMemo(
      () => resolveChartBuckets(settings.chartResolution, settings.smoothing.enabled),
      [settings.chartResolution, settings.smoothing.enabled],
    );

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

    // Safety check: too many series (0 = no limit)
    const maxSeries = settings.maxSeriesCount ?? DEFAULT_SETTINGS.maxSeriesCount;

    const runIds = useMemo(() => lines.map((l) => l.runId), [lines]);

    // Two limits, both expressed in series so the chart reports one number.
    // Both limits resolved into one series count — see resolveChartLimit.
    const { effectiveMaxSeries, overLimit, isRunBound } = resolveChartLimit({
      metricCount: metricNames.length,
      seriesCount: queryPairs.length,
      maxSeries,
    });

    // === Standard + Preview tiers: multi-metric batch with URL-safe chunking ===
    // Chunk metrics into groups to stay within tRPC URL length limits.
    const isMultiMetricQuery = metricNames.length > 1;

    const metricChunks = useMemo(
      () => (isMultiMetricQuery ? chunkArray(metricNames, MULTI_METRIC_CHUNK) : []),
      [isMultiMetricQuery, metricNames],
    );

    // Downsampling algorithm — "avg" (default) or "lttb"
    const algorithm = settings.downsamplingAlgorithm ?? "avg";

    // Multi-metric path: one query per chunk
    const standardMultiQueries = useQueries({
      queries: (isMultiMetricQuery && !overLimit)
        ? metricChunks.map((chunk) => {
            const opts = {
              organizationId,
              projectName,
              logNames: chunk,
              runIds,
              buckets: standardBuckets,
              includeLineage: showInheritedMetrics && forkSteps.size > 0,
              algorithm: algorithm !== "avg" ? algorithm : undefined,
            };
            return {
              queryKey: trpc.runs.data.graphMultiMetricBatchBucketed.queryOptions(opts).queryKey,
              queryFn: ({ signal }: { signal: AbortSignal }) => trpcClient.runs.data.graphMultiMetricBatchBucketed.query(opts, { signal }),
              staleTime,
              gcTime: GC_TIME,
              placeholderData: keepPreviousData,
              enabled: runIds.length > 0,
            };
          })
        : [],
    });

    // Single-metric fallback: use existing endpoint (avoids unnecessary nesting)
    const standardSingleQueries = useQueries({
      queries: (!isMultiMetricQuery && !overLimit)
        ? metricNames.map((metric) => {
            const opts = {
              organizationId,
              projectName,
              logName: metric,
              runIds,
              buckets: standardBuckets,
              includeLineage: showInheritedMetrics && forkSteps.size > 0,
              algorithm: algorithm !== "avg" ? algorithm : undefined,
            };
            return {
              queryKey: trpc.runs.data.graphBatchBucketed.queryOptions(opts).queryKey,
              queryFn: ({ signal }: { signal: AbortSignal }) => trpcClient.runs.data.graphBatchBucketed.query(opts, { signal }),
              staleTime,
              gcTime: GC_TIME,
              placeholderData: keepPreviousData,
              enabled: runIds.length > 0,
            };
          })
        : [],
    });

    // Build a lookup: metric → runId → standard bucketed points
    const standardDataMap = useMemo(() => {
      const map = new Map<string, Record<string, BucketedChartDataPoint[]>>();
      if (isMultiMetricQuery) {
        // Multi-metric: merge all chunk responses, converting columnar → row format
        for (const q of standardMultiQueries) {
          const data = q.data as Record<string, Record<string, ColumnarBucketedSeries>> | undefined;
          if (data) {
            for (const [logName, runData] of Object.entries(data)) {
              const converted: Record<string, BucketedChartDataPoint[]> = {};
              for (const [runId, columnar] of Object.entries(runData)) {
                converted[runId] = fromColumnar(columnar);
              }
              map.set(logName, converted);
            }
          }
        }
      } else {
        // Single-metric fallback
        metricNames.forEach((metric, i) => {
          const data = standardSingleQueries[i]?.data as
            | Record<string, BucketedChartDataPoint[]>
            | undefined;
          if (data) {
            map.set(metric, data);
          }
        });
      }
      return map;
    }, [isMultiMetricQuery, metricNames, ...standardMultiQueries.map(q => q.data), standardSingleQueries]);

    // Preview tier removed — with the optimized ClickHouse query (inline bucket
    // width, no bounds CTE) the standard tier responds in <20ms server-side,
    // making a separate low-res preview unnecessary overhead.

    // Parametric x-axis: plot the y-metrics against another metric instead of
    // step/time. The join runs SERVER-SIDE on raw rows and only the joined
    // pairs get bucketed.
    //
    // This used to fetch the x-metric separately (runs.data.graph, reservoir
    // sampled to every k-th real step) and join it in the browser against the
    // already-bucketed y series (whose steps have been rewritten to synthetic
    // bucket boundaries — step values that were never logged). Exact-step
    // matching between those two sets survives only where the two lattices
    // coincide, so it kept `range / lcm(k, bucketWidth)` points: a heavily
    // decimated curve at best, and frequently zero points — "Could not
    // compare" — even when every raw y point had an exact x partner.
    const isParametricXAxis =
      effectiveXAxis !== "Step" &&
      effectiveXAxis !== "Absolute Time" &&
      effectiveXAxis !== "Relative Time";

    // A drag-zoom on a parametric chart selects a range of the X-METRIC, not of
    // step, so it cannot ride the step-based zoom hook below. Held here and
    // passed to the query as an x-window, which re-buckets only the survivors --
    // that is what makes zooming actually resolve more detail.
    const [parametricZoom, setParametricZoom] = useState<[number, number] | null>(null);
    useEffect(() => {
      setParametricZoom(null);
    }, [effectiveXAxis, metricNames, runIds]);

    const parametricQuery = useQuery({
      ...trpc.runs.data.graphParametricBatchBucketed.queryOptions({
        organizationId,
        projectName,
        runIds,
        logNames: metricNames,
        xMetric: effectiveXAxis,
        buckets: standardBuckets,
        ...(parametricZoom
          ? { xMin: parametricZoom[0], xMax: parametricZoom[1] }
          : {}),
      }),
      enabled: isParametricXAxis && !overLimit,
      staleTime,
      gcTime: GC_TIME,
      placeholderData: keepPreviousData,
    });

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
      // Hooks run before the over-limit early return below, and a zoom range
      // persists across selection changes — so zooming under the cap and then
      // selecting past it left this firing a request the server rejects, even
      // though the chart itself had been replaced by the notice.
      enabled: !overLimit,
      selectedLog: effectiveXAxis,
      staleTime,
      syncedZoomRange,
      sourceStepRange,
      timeStepMapping,
      buckets: standardBuckets,
      algorithm: algorithm !== "avg" ? algorithm : undefined,
    });

    // Route a drag-zoom to whichever axis this chart is actually on. The step
    // hook cannot serve a parametric chart: its range is in x-metric units, so
    // translating it to steps would be a guess. Parametric drags become an
    // x-window on the parametric query instead.
    const handleZoomRangeChange = useCallback(
      (range: [number, number] | null) => {
        if (isParametricXAxis) {
          setParametricZoom(range);
          return;
        }
        onZoomRangeChange(range);
      },
      [isParametricXAxis, onZoomRangeChange],
    );

    // Check error states and get data. The parametric join is a separate
    // request, and a failed one leaves parametricData undefined forever — which
    // the empty-state branch would otherwise render as "never logged close
    // enough to pair", i.e. a confident claim about the data from a request
    // that never answered.
    const parametricFailed = isParametricXAxis && parametricQuery.isError;
    const isError = (isMultiMetricQuery
      ? standardMultiQueries.some((q) => q.isError)
      : standardSingleQueries.some((query) => query.isError)) || parametricFailed;

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
    const allData = useMemo(() => {
      return queryPairs
        .map((pair) => {
          const stdPoints = standardDataMap.get(pair.metric)?.[pair.line.runId];
          if (stdPoints && stdPoints.length > 0) {
            return { data: stdPoints, isLoading: false, pair };
          }
          return { data: [] as BucketedChartDataPoint[], isLoading: true, pair };
        })
        .filter((item) => item.data.length > 0);
    }, [standardDataMap, queryPairs]);

    // In experiments mode, apply piecewise segmentation: each run only shows its
    // exclusive step range so the experiment graph has no overlapping data.
    // Uses parent-child relationships to correctly determine truncation points.
    const experimentSegments = useMemo(() => {
      if (!isExperimentsMode) return null;
      const segmentInfos = lines.map((l) => ({
        runId: l.runId,
        forkStep: l.forkStep ?? null,
        forkedFromRunId: l.forkedFromRunId ?? null,
      }));
      return computeExperimentSegments(segmentInfos);
    }, [isExperimentsMode, lines]);

    const filteredAllData = useMemo(() => {
      if (!experimentSegments || allData.length === 0) return allData;
      const segmentMap = new Map(experimentSegments.map((s) => [s.runId, s]));
      return allData.map((item) => {
        const seg = segmentMap.get(item.pair.line.runId);
        if (!seg) return item;
        const filtered = item.data.filter((d) => {
          if (d.step < seg.minStep) return false;
          if (seg.maxStep != null && d.step > seg.maxStep) return false;
          return true;
        });
        return { ...item, data: filtered };
      });
    }, [allData, experimentSegments]);

    // Server-joined parametric series: logName → encoded runId → columnar {xs, values, …}
    const parametricData = parametricQuery?.data as
      | {
          series: Record<string, Record<string, ColumnarParametricSeries>>;
          runsWithXMetric: string[];
        }
      | undefined;

    const hasAnyData = filteredAllData.some((item) => item.data?.length > 0);
    const allQueriesDone = isMultiMetricQuery
      ? standardMultiQueries.every((q) => !q.isLoading)
      : standardSingleQueries.every((query) => !query.isLoading);

    // We're also loading while the parametric join is in flight.
    const isLoadingCustomLogData =
      isParametricXAxis && parametricData === undefined && !parametricFailed;

    // The parametric term is deliberately OUTSIDE the !hasAnyData guard. The
    // y-metric query and the parametric join are separate requests, and the
    // y-side usually wins the race — so gating on "no data yet" let a chart
    // with y-data but no join result fall straight through to the empty state
    // and announce that the two metrics were never logged near enough to
    // pair, purely because the join had not come back yet. Switching a working chart
    // to a metric x-axis flashed that message every time.
    //
    // Safe against hanging: overLimit returns its own notice before this, and a
    // failed join is excluded above and surfaces through isError instead.
    const isInitialLoading =
      (!hasAnyData && !allQueriesDone) || isLoadingCustomLogData;

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
            ? getDashPattern(dashCycle)
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
        const chartData = filteredAllData
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
          const data = filteredAllData
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
          const data = filteredAllData
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
          const data = filteredAllData
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
          // Parametric chart: y-metrics plotted against effectiveXAxis, joined
          // on step server-side. Each series arrives pre-paired and pre-bucketed.
          if (!parametricData) {
            return null; // still loading — handled by the isInitialLoading branch
          }

          const runsWithX = new Set(parametricData.runsWithXMetric);

          const data = queryPairs.flatMap((pair) => {
            const series = parametricData.series[pair.metric]?.[pair.line.runId];
            if (!series || series.xs.length === 0) {
              return [];
            }

            const props = seriesProps(pair);
            // Drop buckets whose y is all non-finite — they have no position.
            // The envelope travels with the point it belongs to: filtering y
            // without filtering min/max would shift the bands off their
            // buckets and the tooltip would report a neighbour's spread.
            const x: number[] = [];
            const y: number[] = [];
            const yMin: (number | null)[] = [];
            const yMax: (number | null)[] = [];
            for (let i = 0; i < series.xs.length; i++) {
              const yv = series.values[i];
              if (yv == null) continue;
              x.push(series.xs[i]);
              y.push(yv);
              yMin.push(series.minYs[i] ?? null);
              yMax.push(series.maxYs[i] ?? null);
            }
            if (x.length === 0) return [];

            // Points arrive in step order — curve order. An x-metric that turns
            // around (warmup→decay LR, any oscillating counter) becomes several
            // monotonic legs, each its own series. One leg is the usual case and
            // behaves exactly as before.
            const legs = splitMonotonicLegs(x, y);
            return legs.flatMap((leg, legIndex) => {
              const label = legs.length > 1
                ? `${props.label} (${leg.direction === 1 ? "↑" : "↓"}${legIndex + 1})`
                : props.label;
              const seriesId = legs.length > 1 ? `${props.seriesId}:leg${legIndex}` : props.seriesId;
              const color = props.color;
              // withMeta, not a bare spread: seriesProps speaks the layout's
              // vocabulary (rawRunName/displayId) and the tooltip reads
              // runName/runId. Spreading props straight through left the
              // DISPLAY ID and RUN NAME columns blank on every parametric
              // chart, since neither key was the one being looked up.
              const main = withMeta(
                applySmoothing(
                  {
                    ...props,
                    x: leg.x,
                    y: leg.y,
                    label,
                    seriesId,
                    // Later legs dash so overlapping branches stay tellable apart
                    // without spending another palette colour on the same run.
                    dash: legIndex === 0 ? props.dash : getDashPattern(legIndex),
                  },
                  settings.smoothing,
                  isMultiMetric,
                ),
                props,
              );
              // A leg is a slice of the joined curve (reversed when it
              // descends), so the envelope is the same slice of min/max.
              return [
                ...main,
                ...envelopeSeries(
                  leg.x,
                  leg.indices.map((i) => yMin[i]),
                  leg.indices.map((i) => yMax[i]),
                  label,
                  color,
                  seriesId,
                ),
              ];
            });
          });

          if (data.length === 0) {
            // Nothing to draw. Separate the two very different reasons so the
            // empty state can say which one it is: the x-metric was never
            // logged for these runs, vs. it was logged but shares no steps
            // with the y-metric.
            const anyRunHasX = queryPairs.some((pair) => runsWithX.has(pair.line.runId));
            return {
              type: "error" as const,
              errorType: anyRunHasX
                ? ("no-shared-steps" as const)
                : ("x-metric-missing" as const),
            };
          }

          return {
            type: "data" as const,
            data,
            xlabel: effectiveXAxis,
            isDateTime: false,
            className: "h-full w-full",
          };
        }
      }
    }, [filteredAllData, parametricData, settings, effectiveXAxis, title, xlabel, hasAnyData, queryPairs, getSeriesLabel, zoomDataMap, isMultiMetric, isMultiRun, chartColors, metricNames, lines, runBaselineMap]);

    // Too many series warning
    if (overLimit) {
      return (
        <WidgetLimitNotice
          title={title}
          unit="series"
          count={queryPairs.length}
          max={effectiveMaxSeries}
          hint={
            limitHint ??
            (isRunBound ? undefined : "Reduce the number of selected runs or metrics.")
          }
        />
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
        <ChartLoadingSkeleton
          title={title}
          pills={lines.map((l) => ({
            id: l.runId,
            label: l.runName,
            color: l.color,
          }))}
        />
      );
    }

    // Empty state - only if we have no data and all queries are done
    if (allQueriesDone && !hasAnyData) {
      return (
        <div className="flex h-full w-full flex-grow flex-col items-center justify-center bg-accent">
          <h2 className="text-2xl font-bold">{title}</h2>
          <p className="text-sm text-gray-500">No data received yet</p>
        </div>
      );
    }

    // Handle error cases from chart data computation.
    // Name the actual cause — these two states look identical to the user but
    // need completely different fixes, and collapsing them into one sentence
    // left people with no way to tell which problem they had.
    if (!chartResult || chartResult.type === "error") {
      const errorType = chartResult?.type === "error" ? chartResult.errorType : undefined;
      return (
        <div className="flex h-full flex-grow flex-col items-center justify-center bg-accent p-4">
          <p className="text-center text-sm text-gray-500">
            {errorType === "x-metric-missing" ? (
              <>
                <code className="rounded bg-muted px-1">{effectiveXAxis}</code> was
                never logged for {lines.length === 1 ? "this run" : "these runs"},
                so it can&apos;t be used as an x-axis.
              </>
            ) : (
              <>
                <code className="rounded bg-muted px-1">{title}</code> was never
                logged close enough to a{" "}
                <code className="rounded bg-muted px-1">{effectiveXAxis}</code>{" "}
                reading to pair the two, so there are no points to plot.
              </>
            )}
          </p>
        </div>
      );
    }

    // Render the chart with memoized data
    return (
      <div className="relative h-full w-full">
        {/* Zoom refetch loading indicator */}
        {(isZoomFetching || (isParametricXAxis && parametricQuery.isFetching)) && (
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
          tooltipInterpolation={settings.tooltipInterpolation}
          outlierDetection={settings.yAxisScaleMode === "outlier-aware"}
          spanGaps={!settings.skipMissingValues}
          onZoomRangeChange={handleZoomRangeChange}
          yZoomRange={yZoomRange}
          onYZoomRangeChange={onYZoomRangeChange}
          forkSteps={showInheritedMetrics ? forkSteps : undefined}
          extraLeftPadding={extraLeftPadding}
          extraRightPadding={extraRightPadding}
        />
      </div>
    );
  },
);
