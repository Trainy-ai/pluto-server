import { useState, useMemo, useCallback } from "react";
import { useQueries } from "@tanstack/react-query";
import { trpc, trpcClient } from "@/utils/trpc";
import type { MetricDataPoint } from "@/lib/db/index";

interface UseZoomRefetchOptions {
  organizationId: string;
  projectName: string;
  /** Metric names to fetch zoom data for. Supports single or multiple metrics. */
  logNames: string[];
  /** Run IDs to fetch zoom data for (single-run = 1 element, multi-run = N elements) */
  runIds: string[];
  /** Only fire zoom queries when selectedLog === "Step" */
  selectedLog: string;
  /** Query stale time */
  staleTime?: number;
  /** Whether zoom refetch is enabled (default: true) */
  enabled?: boolean;
  /** External zoom range from chart sync context — drives refetch for synced charts */
  syncedZoomRange?: [number, number] | null;
}

/** Build a composite key for the zoom data map: "runId\0metricName" */
export function zoomKey(runId: string, metricName: string): string {
  return `${runId}\0${metricName}`;
}

interface UseZoomRefetchReturn {
  /** Map of zoomKey(runId, metric) → full-resolution data, or null if not zooming */
  zoomDataMap: Map<string, MetricDataPoint[]> | null;
  /** Pass to <LineChart onZoomRangeChange={...}> */
  onZoomRangeChange: (range: [number, number] | null) => void;
  /** True while zoom refetch queries are in-flight */
  isZoomFetching: boolean;
}

/** Fast tier: quick server re-downsample for immediate detail upgrade (~200-500ms) */
const ZOOM_FAST_MAX_POINTS = 10_000;
/** Full tier: high-fidelity data that takes longer to load (4-15s for large datasets) */
const ZOOM_FULL_MAX_POINTS = 100_000;
/** Total point budget across all runs for zoom queries (full tier) */
const ZOOM_TOTAL_BUDGET = 500_000;
/** Total point budget across all runs for fast tier */
const ZOOM_FAST_BUDGET = 100_000;
/** Threshold for switching from individual queries to batch */
const BATCH_THRESHOLD = 3;

/**
 * Hook that manages zoom-triggered server re-fetch for full-resolution step data.
 *
 * When the backend returns 10k-point overview via reservoir sampling, zoomed-in views
 * only show sampled steps (e.g. multiples of 10). This hook fires a range query for
 * full-resolution data in the visible step range when the user zooms in.
 *
 * Supports multiple metrics: fires one batch/individual query per metric.
 * For multi-run charts (>= 3 runs), uses batch queries per metric instead of
 * N individual queries to avoid overwhelming the server.
 *
 * Used by both single-run and multi-run chart components.
 */
export function useZoomRefetch({
  organizationId,
  projectName,
  logNames,
  runIds,
  selectedLog,
  staleTime = Infinity,
  enabled = true,
  syncedZoomRange,
}: UseZoomRefetchOptions): UseZoomRefetchReturn {
  const [localZoomRange, setLocalZoomRange] = useState<[number, number] | null>(null);

  // Use synced range from context if available, otherwise use local range from this chart's zoom
  const zoomStepRange = syncedZoomRange
    ? [Math.floor(syncedZoomRange[0]), Math.ceil(syncedZoomRange[1])] as [number, number]
    : localZoomRange;

  const isZooming = enabled && zoomStepRange !== null && selectedLog === "Step";
  const useBatch = runIds.length >= BATCH_THRESHOLD;

  // Total series = metrics × runs — divide budgets accordingly
  const totalSeries = logNames.length * runIds.length;

  // === Batch path: one batch query per metric (multi-run) ===
  const batchRangeWidth = isZooming && useBatch && zoomStepRange
    ? zoomStepRange[1] - zoomStepRange[0]
    : 0;

  const fastPerRun = Math.floor(ZOOM_FAST_BUDGET / totalSeries);
  const skipFastBatch = batchRangeWidth <= fastPerRun;

  const fastBatchQueries = useQueries({
    queries:
      isZooming && useBatch && zoomStepRange
        ? logNames.map((metric) => {
            const opts = {
              organizationId,
              projectName,
              logName: metric,
              runIds,
              stepMin: zoomStepRange[0],
              stepMax: zoomStepRange[1],
              maxPoints: fastPerRun,
              preview: true,
            };
            return {
              queryKey: [...trpc.runs.data.graphBatch.queryOptions(opts).queryKey, "zoom-fast"],
              queryFn: () => trpcClient.runs.data.graphBatch.query(opts),
              staleTime,
              gcTime: 60_000,
              enabled: !skipFastBatch,
            };
          })
        : [],
  });

  const fullBatchQueries = useQueries({
    queries:
      isZooming && useBatch && zoomStepRange
        ? logNames.map((metric) => {
            const perRunBudget = Math.floor(ZOOM_TOTAL_BUDGET / totalSeries);
            const maxPoints = batchRangeWidth <= perRunBudget ? 0 : perRunBudget;
            const opts = {
              organizationId,
              projectName,
              logName: metric,
              runIds,
              stepMin: zoomStepRange[0],
              stepMax: zoomStepRange[1],
              maxPoints,
            };
            return {
              queryKey: [...trpc.runs.data.graphBatch.queryOptions(opts).queryKey, "zoom-full"],
              queryFn: () => trpcClient.runs.data.graphBatch.query(opts),
              staleTime,
              gcTime: 60_000,
            };
          })
        : [],
  });

  // === Individual path: queries per metric × run (single-run or few runs) ===
  const individualRangeWidth = isZooming && !useBatch && zoomStepRange
    ? zoomStepRange[1] - zoomStepRange[0]
    : 0;
  const skipFastIndividual = individualRangeWidth <= ZOOM_FAST_MAX_POINTS;

  const fastIndividualQueries = useQueries({
    queries:
      isZooming && !useBatch && zoomStepRange && !skipFastIndividual
        ? logNames.flatMap((metric) =>
            runIds.map((runId) => {
              const opts = {
                organizationId,
                projectName,
                runId,
                logName: metric,
                stepMin: zoomStepRange[0],
                stepMax: zoomStepRange[1],
                maxPoints: Math.floor(ZOOM_FAST_MAX_POINTS / logNames.length),
                preview: true,
              };
              return {
                queryKey: trpc.runs.data.graph.queryOptions(opts).queryKey,
                queryFn: () => trpcClient.runs.data.graph.query(opts),
                staleTime,
                gcTime: 60_000,
              };
            })
          )
        : [],
  });

  const fullIndividualQueries = useQueries({
    queries:
      isZooming && !useBatch && zoomStepRange
        ? logNames.flatMap((metric) =>
            runIds.map((runId) => {
              const perSeriesBudget = Math.floor(ZOOM_FULL_MAX_POINTS / logNames.length);
              const maxPoints = individualRangeWidth <= perSeriesBudget ? 0 : perSeriesBudget;
              const opts = {
                organizationId,
                projectName,
                runId,
                logName: metric,
                stepMin: zoomStepRange[0],
                stepMax: zoomStepRange[1],
                maxPoints,
              };
              return {
                queryKey: trpc.runs.data.graph.queryOptions(opts).queryKey,
                queryFn: () => trpcClient.runs.data.graph.query(opts),
                staleTime,
                gcTime: 60_000,
              };
            })
          )
        : [],
  });

  // Map zoom query results by zoomKey(runId, metric) — prefer full tier, fall back to fast tier
  const zoomDataMap = useMemo(() => {
    if (!isZooming || !zoomStepRange) return null;

    const map = new Map<string, MetricDataPoint[]>();

    if (useBatch) {
      // Batch queries: one per metric, each returns Record<runId, data[]>
      logNames.forEach((metric, metricIdx) => {
        const fullData = fullBatchQueries[metricIdx]?.data as Record<string, MetricDataPoint[]> | undefined;
        // Fast batch queries may be fewer (skipped if range is small)
        // Find the matching fast query for this metric
        const fastData = fastBatchQueries[metricIdx]?.data as Record<string, MetricDataPoint[]> | undefined;
        for (const runId of runIds) {
          const points = fullData?.[runId] ?? fastData?.[runId];
          if (points && points.length > 0) {
            map.set(zoomKey(runId, metric), points);
          }
        }
      });
    } else {
      // Individual queries: logNames × runIds, flattened
      logNames.forEach((metric, metricIdx) => {
        runIds.forEach((runId, runIdx) => {
          const flatIdx = metricIdx * runIds.length + runIdx;
          const points = (fullIndividualQueries[flatIdx]?.data ?? fastIndividualQueries[flatIdx]?.data) as MetricDataPoint[] | undefined;
          if (points && points.length > 0) {
            map.set(zoomKey(runId, metric), points);
          }
        });
      });
    }

    return map.size > 0 ? map : null;
  }, [isZooming, zoomStepRange, useBatch, logNames, runIds,
      fullBatchQueries, fastBatchQueries, fullIndividualQueries, fastIndividualQueries]);

  // Callback for the chart's zoom range change — triggers server re-fetch in Step mode
  const onZoomRangeChange = useCallback(
    (range: [number, number] | null) => {
      if (range !== null && selectedLog === "Step") {
        setLocalZoomRange([Math.floor(range[0]), Math.ceil(range[1])]);
      } else {
        setLocalZoomRange(null);
      }
    },
    [selectedLog],
  );

  const isZoomFetching = isZooming && (
    useBatch
      ? fullBatchQueries.some((q) => q.isFetching) || fastBatchQueries.some((q) => q.isFetching)
      : fullIndividualQueries.some((q) => q.isFetching) || fastIndividualQueries.some((q) => q.isFetching)
  );

  return { zoomDataMap, onZoomRangeChange, isZoomFetching };
}
