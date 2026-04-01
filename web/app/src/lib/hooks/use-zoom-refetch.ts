import { useState, useMemo, useCallback, useRef } from "react";
import { useQueries, useQueryClient } from "@tanstack/react-query";
import { trpc, trpcClient } from "@/utils/trpc";
import { MULTI_METRIC_CHUNK, chunkArray, fromColumnar, type BucketedChartDataPoint, type ColumnarBucketedSeries } from "@/lib/chart-data-utils";
import { translateZoomToStepRange, type TimeStepMapping } from "./zoom-translate";
import { MAX_BUCKETS, computeEffectiveZoomBuckets } from "@/lib/chart-bucket-estimate";

// Re-export for consumers
export { translateZoomToStepRange, type TimeStepMapping } from "./zoom-translate";
export { computeEffectiveZoomBuckets } from "@/lib/chart-bucket-estimate";

interface UseZoomRefetchOptions {
  organizationId: string;
  projectName: string;
  /** Metric names to fetch zoom data for. Supports single or multiple metrics. */
  logNames: string[];
  /** Run IDs to fetch zoom data for (single-run = 1 element, multi-run = N elements) */
  runIds: string[];
  /** X-axis mode — fires zoom queries for "Step" and "Relative Time" */
  selectedLog: string;
  /** Query stale time */
  staleTime?: number;
  /** Whether zoom refetch is enabled (default: true) */
  enabled?: boolean;
  /** External zoom range from chart sync context — drives refetch for synced charts */
  syncedZoomRange?: [number, number] | null;
  /**
   * Original step bounds from a cross-axis zoom (Step→RelTime). When set,
   * bypasses the lossy time→step interpolation roundtrip for refetch.
   */
  sourceStepRange?: [number, number] | null;
  /**
   * Time-to-step mapping for translating relative-time zoom ranges to step ranges.
   * Each entry maps a run ID to its sorted arrays of [relTimeSecs, steps].
   * When omitted, relative-time zoom refetch is disabled.
   */
  timeStepMapping?: TimeStepMapping | null;
  /** Number of buckets for zoom queries. Resolved by the caller via resolveChartBuckets(). */
  buckets: number;
  /** Server-side downsampling algorithm ("avg" or "lttb"). */
  algorithm?: "avg" | "lttb";
}

/** Build a composite key for the zoom data map: "runId\0metricName" */
export function zoomKey(runId: string, metricName: string): string {
  return `${runId}\0${metricName}`;
}

interface UseZoomRefetchReturn {
  /** Map of zoomKey(runId, metric) → bucketed data, or null if not zooming */
  zoomDataMap: Map<string, BucketedChartDataPoint[]> | null;
  /** Pass to <LineChart onZoomRangeChange={...}> */
  onZoomRangeChange: (range: [number, number] | null) => void;
  /** True while zoom refetch queries are in-flight */
  isZoomFetching: boolean;
}

/** Always use batch queries for globally-aligned bucket boundaries */
const BATCH_THRESHOLD = 1;

/**
 * Hook that manages zoom-triggered server re-fetch using bucketed downsampling.
 *
 * When the user zooms in, fires a graphBucketed/graphBatchBucketed query with
 * stepMin/stepMax to re-bucket only the visible range into 1000 buckets.
 * Single tier — no fast/full split needed since bucketed queries are fast.
 *
 * For "Relative Time" mode, translates the zoom range (in seconds) to step
 * bounds using the provided timeStepMapping.
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
  sourceStepRange,
  timeStepMapping,
  buckets: zoomBuckets,
  algorithm,
}: UseZoomRefetchOptions): UseZoomRefetchReturn {
  const [localZoomRange, setLocalZoomRange] = useState<[number, number] | null>(null);
  const queryClient = useQueryClient();

  const isRelativeTime = selectedLog === "Relative Time";
  const isStep = selectedLog === "Step";
  const supportsZoom = isStep || isRelativeTime;

  // Use synced range from context if available, otherwise use local range
  const rawZoomRange = syncedZoomRange ?? localZoomRange;

  // For relative time, prefer sourceStepRange (original step bounds from cross-axis
  // zoom) to avoid lossy time→step interpolation with irregular time spacing.
  // Falls back to translateZoomToStepRange for direct relative-time zooms.
  const zoomStepRange = useMemo<[number, number] | null>(
    () => {
      if (isRelativeTime && sourceStepRange) {
        return [Math.floor(sourceStepRange[0]), Math.ceil(sourceStepRange[1])];
      }
      return translateZoomToStepRange(rawZoomRange, selectedLog, timeStepMapping);
    },
    [rawZoomRange, selectedLog, timeStepMapping, isRelativeTime, sourceStepRange],
  );

  // Skip zoom refetch when already at max resolution: if the step range
  // fits within the bucket count, every step gets its own bucket and
  // refetching would return identical data.
  const isMaxResolution = zoomStepRange !== null &&
    (zoomStepRange[1] - zoomStepRange[0] + 1) <= zoomBuckets;

  // When zoomed, request up to 1 bucket per visible step (capped at server max).
  // This gives much higher fidelity than reusing the overview bucket count.
  const effectiveZoomBuckets = computeEffectiveZoomBuckets(zoomStepRange, zoomBuckets);

  const isZooming = enabled && zoomStepRange !== null && supportsZoom && !isMaxResolution;
  const useBatch = runIds.length >= BATCH_THRESHOLD;
  const isMultiMetric = logNames.length > 1;

  // Chunk metrics into groups to stay within tRPC URL length limits
  const metricChunks = useMemo(
    () => (isMultiMetric ? chunkArray(logNames, MULTI_METRIC_CHUNK) : []),
    [isMultiMetric, logNames],
  );

  // === Multi-metric batch path: chunked queries for all metrics ===
  const zoomMultiQueries = useQueries({
    queries:
      isZooming && useBatch && isMultiMetric && zoomStepRange
        ? metricChunks.map((chunk) => {
            const opts = {
              organizationId,
              projectName,
              logNames: chunk,
              runIds,
              buckets: effectiveZoomBuckets,
              stepMin: zoomStepRange[0],
              stepMax: zoomStepRange[1],
              algorithm: algorithm !== "avg" ? algorithm : undefined,
            };
            return {
              queryKey: [...trpc.runs.data.graphMultiMetricBatchBucketed.queryOptions(opts).queryKey, "zoom"],
              queryFn: ({ signal }: { signal: AbortSignal }) => trpcClient.runs.data.graphMultiMetricBatchBucketed.query(opts, { signal }),
              staleTime,
              gcTime: 60_000,
            };
          })
        : [],
  });

  // === Single-metric batch fallback ===
  const batchQueries = useQueries({
    queries:
      isZooming && useBatch && !isMultiMetric && zoomStepRange
        ? logNames.map((metric) => {
            const opts = {
              organizationId,
              projectName,
              logName: metric,
              runIds,
              buckets: effectiveZoomBuckets,
              stepMin: zoomStepRange[0],
              stepMax: zoomStepRange[1],
              algorithm: algorithm !== "avg" ? algorithm : undefined,
            };
            return {
              queryKey: [...trpc.runs.data.graphBatchBucketed.queryOptions(opts).queryKey, "zoom"],
              queryFn: ({ signal }: { signal: AbortSignal }) => trpcClient.runs.data.graphBatchBucketed.query(opts, { signal }),
              staleTime,
              gcTime: 60_000,
            };
          })
        : [],
  });

  // === Individual path: queries per metric × run (single-run or few runs) ===
  const individualQueries = useQueries({
    queries:
      isZooming && !useBatch && zoomStepRange
        ? logNames.flatMap((metric) =>
            runIds.map((runId) => {
              const opts = {
                organizationId,
                projectName,
                runId,
                logName: metric,
                buckets: effectiveZoomBuckets,
                stepMin: zoomStepRange[0],
                stepMax: zoomStepRange[1],
                algorithm: algorithm !== "avg" ? algorithm : undefined,
              };
              return {
                queryKey: [...trpc.runs.data.graphBucketed.queryOptions(opts).queryKey, "zoom"],
                queryFn: ({ signal }: { signal: AbortSignal }) => trpcClient.runs.data.graphBucketed.query(opts, { signal }),
                staleTime,
                gcTime: 60_000,
              };
            })
          )
        : [],
  });

  // Preserve previous zoom data while new queries are in-flight.
  // Without this, the chart flashes back to the full-range view during refetch
  // because zoomDataMap becomes null while queries load.
  const prevZoomDataRef = useRef<Map<string, BucketedChartDataPoint[]> | null>(null);

  // Map zoom query results by zoomKey(runId, metric)
  const zoomDataMap = useMemo(() => {
    if (!isZooming || !zoomStepRange) {
      prevZoomDataRef.current = null;
      return null;
    }

    const map = new Map<string, BucketedChartDataPoint[]>();

    if (useBatch && isMultiMetric) {
      // Multi-metric path: merge all chunk responses, converting columnar → row format
      for (const q of zoomMultiQueries) {
        const data = q.data as Record<string, Record<string, ColumnarBucketedSeries>> | undefined;
        if (data) {
          for (const [metric, byRun] of Object.entries(data)) {
            for (const runId of runIds) {
              const columnar = byRun[runId];
              if (columnar && columnar.steps.length > 0) {
                map.set(zoomKey(runId, metric), fromColumnar(columnar));
              }
            }
          }
        }
      }
    } else if (useBatch) {
      logNames.forEach((metric, metricIdx) => {
        const data = batchQueries[metricIdx]?.data as Record<string, BucketedChartDataPoint[]> | undefined;
        for (const runId of runIds) {
          const points = data?.[runId];
          if (points && points.length > 0) {
            map.set(zoomKey(runId, metric), points);
          }
        }
      });
    } else {
      logNames.forEach((metric, metricIdx) => {
        runIds.forEach((runId, runIdx) => {
          const flatIdx = metricIdx * runIds.length + runIdx;
          const points = individualQueries[flatIdx]?.data as BucketedChartDataPoint[] | undefined;
          if (points && points.length > 0) {
            map.set(zoomKey(runId, metric), points);
          }
        });
      });
    }

    if (map.size > 0) {
      prevZoomDataRef.current = map;
      return map;
    }

    // Queries still loading — return previous zoom data to avoid flash to full range
    return prevZoomDataRef.current;
  }, [isZooming, zoomStepRange, useBatch, isMultiMetric, logNames, runIds, ...zoomMultiQueries.map(q => q.data), batchQueries, individualQueries]);

  const onZoomRangeChange = useCallback(
    (range: [number, number] | null) => {
      if (range !== null && supportsZoom) {
        // Compute step range eagerly to fire prefetch BEFORE React re-render.
        // Without this, the network request waits 500ms+ for the React render
        // cascade (useMemo recomputation of 95 series) before useQueries fires.
        let stepRange: [number, number] | null = null;
        if (isStep) {
          stepRange = [Math.floor(range[0]), Math.ceil(range[1])];
          setLocalZoomRange(stepRange);
        } else {
          setLocalZoomRange(range);
          stepRange = translateZoomToStepRange(range, selectedLog, timeStepMapping);
        }

        // Eagerly prefetch zoom data — fires the network request immediately,
        // in parallel with React's re-render cycle
        if (stepRange && logNames.length > 1 && runIds.length > 0) {
          const spanSize = stepRange[1] - stepRange[0] + 1;
          if (spanSize > zoomBuckets) {
            const chunks = chunkArray(logNames, MULTI_METRIC_CHUNK);
            for (const chunk of chunks) {
              const opts = {
                organizationId,
                projectName,
                logNames: chunk,
                runIds,
                buckets: zoomBuckets,
                stepMin: stepRange[0],
                stepMax: stepRange[1],
                algorithm: algorithm !== "avg" ? algorithm : undefined,
              };
              queryClient.prefetchQuery({
                queryKey: [...trpc.runs.data.graphMultiMetricBatchBucketed.queryOptions(opts).queryKey, "zoom"],
                queryFn: ({ signal }) => trpcClient.runs.data.graphMultiMetricBatchBucketed.query(opts, { signal }),
                staleTime,
              });
            }
          }
        }
      } else {
        setLocalZoomRange(null);
      }
    },
    [supportsZoom, isStep, selectedLog, timeStepMapping, logNames, runIds, zoomBuckets, organizationId, projectName, queryClient, staleTime],
  );

  const isZoomFetching = isZooming && (
    useBatch && isMultiMetric
      ? zoomMultiQueries.some((q) => q.isFetching)
      : useBatch
        ? batchQueries.some((q) => q.isFetching)
        : individualQueries.some((q) => q.isFetching)
  );

  return { zoomDataMap, onZoomRangeChange, isZoomFetching };
}
