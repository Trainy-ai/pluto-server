import { useState, useMemo, useCallback } from "react";
import { useQueries } from "@tanstack/react-query";
import { trpc, trpcClient } from "@/utils/trpc";
import type { BucketedChartDataPoint } from "@/lib/chart-data-utils";
import { estimateStandardBuckets } from "@/lib/chart-bucket-estimate";
import { translateZoomToStepRange, type TimeStepMapping } from "./zoom-translate";

// Re-export for consumers
export { translateZoomToStepRange, type TimeStepMapping } from "./zoom-translate";

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
}: UseZoomRefetchOptions): UseZoomRefetchReturn {
  // Compute once on mount — changing bucket count changes query key, so avoid recomputing
  const zoomBuckets = useMemo(() => estimateStandardBuckets(), []);
  const [localZoomRange, setLocalZoomRange] = useState<[number, number] | null>(null);

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

  const isZooming = enabled && zoomStepRange !== null && supportsZoom;
  const useBatch = runIds.length >= BATCH_THRESHOLD;

  // === Batch path: one batch query per metric (multi-run) ===
  const batchQueries = useQueries({
    queries:
      isZooming && useBatch && zoomStepRange
        ? logNames.map((metric) => {
            const opts = {
              organizationId,
              projectName,
              logName: metric,
              runIds,
              buckets: zoomBuckets,
              stepMin: zoomStepRange[0],
              stepMax: zoomStepRange[1],
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
                buckets: zoomBuckets,
                stepMin: zoomStepRange[0],
                stepMax: zoomStepRange[1],
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

  // Map zoom query results by zoomKey(runId, metric)
  const zoomDataMap = useMemo(() => {
    if (!isZooming || !zoomStepRange) return null;

    const map = new Map<string, BucketedChartDataPoint[]>();

    if (useBatch) {
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

    return map.size > 0 ? map : null;
  }, [isZooming, zoomStepRange, useBatch, logNames, runIds, batchQueries, individualQueries]);

  const onZoomRangeChange = useCallback(
    (range: [number, number] | null) => {
      if (range !== null && supportsZoom) {
        if (isStep) {
          setLocalZoomRange([Math.floor(range[0]), Math.ceil(range[1])]);
        } else {
          // For relative time, store the raw seconds range — translation
          // to steps happens in the zoomStepRange useMemo above.
          setLocalZoomRange(range);
        }
      } else {
        setLocalZoomRange(null);
      }
    },
    [supportsZoom, isStep],
  );

  const isZoomFetching = isZooming && (
    useBatch
      ? batchQueries.some((q) => q.isFetching)
      : individualQueries.some((q) => q.isFetching)
  );

  return { zoomDataMap, onZoomRangeChange, isZoomFetching };
}
