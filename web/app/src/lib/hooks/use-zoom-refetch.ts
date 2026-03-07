import { useState, useMemo, useCallback } from "react";
import { useQueries } from "@tanstack/react-query";
import { trpc, trpcClient } from "@/utils/trpc";
import type { BucketedChartDataPoint } from "@/lib/chart-data-utils";
import { estimateStandardBuckets } from "@/lib/chart-bucket-estimate";

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
  // Compute once on mount — changing bucket count changes query key, so avoid recomputing
  const zoomBuckets = useMemo(() => estimateStandardBuckets(), []);
  const [localZoomRange, setLocalZoomRange] = useState<[number, number] | null>(null);

  // Use synced range from context if available, otherwise use local range
  const zoomStepRange = syncedZoomRange
    ? [Math.floor(syncedZoomRange[0]), Math.ceil(syncedZoomRange[1])] as [number, number]
    : localZoomRange;

  const isZooming = enabled && zoomStepRange !== null && selectedLog === "Step";
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
              queryFn: () => trpcClient.runs.data.graphBatchBucketed.query(opts),
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
                queryFn: () => trpcClient.runs.data.graphBucketed.query(opts),
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
      ? batchQueries.some((q) => q.isFetching)
      : individualQueries.some((q) => q.isFetching)
  );

  return { zoomDataMap, onZoomRangeChange, isZoomFetching };
}
