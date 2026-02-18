import { useState, useMemo, useCallback } from "react";
import { useQuery, useQueries } from "@tanstack/react-query";
import { trpc, trpcClient } from "@/utils/trpc";
import type { MetricDataPoint } from "@/lib/db/index";

interface UseZoomRefetchOptions {
  organizationId: string;
  projectName: string;
  logName: string;
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

interface UseZoomRefetchReturn {
  /** Map of runId → full-resolution data for the zoomed range, or null if not zooming */
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
 * For multi-run charts (>= 3 runs), uses a single batch query instead of N individual
 * queries to avoid overwhelming the server.
 *
 * Used by both single-run and multi-run chart components.
 */
export function useZoomRefetch({
  organizationId,
  projectName,
  logName,
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

  // === Batch path: two-tier queries for all runs (multi-run) ===
  const batchRangeWidth = isZooming && useBatch && zoomStepRange
    ? zoomStepRange[1] - zoomStepRange[0]
    : 0;

  const fastBatchOpts = useMemo(() => {
    if (!isZooming || !useBatch || !zoomStepRange) return null;
    const fastPerRun = Math.floor(ZOOM_FAST_BUDGET / runIds.length);
    // Skip fast tier if range is small enough that full tier returns all data quickly
    if (batchRangeWidth <= fastPerRun) return null;
    return {
      organizationId,
      projectName,
      logName,
      runIds,
      stepMin: zoomStepRange[0],
      stepMax: zoomStepRange[1],
      maxPoints: fastPerRun,
      preview: true, // Use fast LIMIT scan, no window functions
    };
  }, [isZooming, useBatch, zoomStepRange, batchRangeWidth, organizationId, projectName, logName, runIds]);

  const fullBatchOpts = useMemo(() => {
    if (!isZooming || !useBatch || !zoomStepRange) return null;
    const perRunBudget = Math.floor(ZOOM_TOTAL_BUDGET / runIds.length);
    const maxPoints = batchRangeWidth <= perRunBudget ? 0 : perRunBudget;
    return {
      organizationId,
      projectName,
      logName,
      runIds,
      stepMin: zoomStepRange[0],
      stepMax: zoomStepRange[1],
      maxPoints,
    };
  }, [isZooming, useBatch, zoomStepRange, batchRangeWidth, organizationId, projectName, logName, runIds]);

  const fastBatchQuery = useQuery({
    queryKey: fastBatchOpts
      ? [...trpc.runs.data.graphBatch.queryOptions(fastBatchOpts).queryKey, "zoom-fast"]
      : ["noop-zoom-batch-fast"],
    queryFn: () => trpcClient.runs.data.graphBatch.query(fastBatchOpts!),
    staleTime,
    gcTime: 60_000,
    enabled: fastBatchOpts !== null,
  });

  const fullBatchQuery = useQuery({
    queryKey: fullBatchOpts
      ? [...trpc.runs.data.graphBatch.queryOptions(fullBatchOpts).queryKey, "zoom-full"]
      : ["noop-zoom-batch-full"],
    queryFn: () => trpcClient.runs.data.graphBatch.query(fullBatchOpts!),
    staleTime,
    gcTime: 60_000,
    enabled: fullBatchOpts !== null,
  });

  // === Individual path: two-tier queries per run (single-run or few runs) ===
  const individualRangeWidth = isZooming && !useBatch && zoomStepRange
    ? zoomStepRange[1] - zoomStepRange[0]
    : 0;
  // Skip fast tier if range is small enough that full tier returns all data quickly
  const skipFastIndividual = individualRangeWidth <= ZOOM_FAST_MAX_POINTS;

  const fastQueries = useQueries({
    queries:
      isZooming && !useBatch && zoomStepRange && !skipFastIndividual
        ? runIds.map((runId) => {
            const opts = {
              organizationId,
              projectName,
              runId,
              logName,
              stepMin: zoomStepRange[0],
              stepMax: zoomStepRange[1],
              maxPoints: ZOOM_FAST_MAX_POINTS,
              preview: true, // Use fast LIMIT scan, no window functions
            };
            return {
              queryKey: trpc.runs.data.graph.queryOptions(opts).queryKey,
              queryFn: () => trpcClient.runs.data.graph.query(opts),
              staleTime,
              gcTime: 60_000,
            };
          })
        : [],
  });

  const fullQueries = useQueries({
    queries:
      isZooming && !useBatch && zoomStepRange
        ? runIds.map((runId) => {
            const maxPoints = individualRangeWidth <= ZOOM_FULL_MAX_POINTS ? 0 : ZOOM_FULL_MAX_POINTS;
            const opts = {
              organizationId,
              projectName,
              runId,
              logName,
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
        : [],
  });

  // Map zoom query results by runId — prefer full tier, fall back to fast tier
  const zoomDataMap = useMemo(() => {
    if (!isZooming || !zoomStepRange) return null;

    const map = new Map<string, MetricDataPoint[]>();

    if (useBatch) {
      const fullData = fullBatchQuery.data as Record<string, MetricDataPoint[]> | undefined;
      const fastData = fastBatchQuery.data as Record<string, MetricDataPoint[]> | undefined;
      for (const runId of runIds) {
        const points = fullData?.[runId] ?? fastData?.[runId];
        if (points && points.length > 0) {
          map.set(runId, points);
        }
      }
    } else {
      runIds.forEach((runId, i) => {
        const points = (fullQueries[i]?.data ?? fastQueries[i]?.data) as MetricDataPoint[] | undefined;
        if (points && points.length > 0) {
          map.set(runId, points);
        }
      });
    }

    return map.size > 0 ? map : null;
  }, [isZooming, zoomStepRange, useBatch, fullBatchQuery.data, fastBatchQuery.data, fullQueries, fastQueries, runIds]);

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
      ? fullBatchQuery.isFetching || fastBatchQuery.isFetching
      : fullQueries.some((q) => q.isFetching) || fastQueries.some((q) => q.isFetching)
  );

  return { zoomDataMap, onZoomRangeChange, isZoomFetching };
}
