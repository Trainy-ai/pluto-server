import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { trpc, trpcClient } from "@/utils/trpc";
import { metricsCache, type MetricDataPoint } from "@/lib/db/index";
import { useLocalQueries } from "@/lib/hooks/use-local-query";

/** Preview tier: fast LIMIT query via batch, 1k points per run */
const PREVIEW_MAX_POINTS = 1_000;

interface ProgressiveMultiBatchOptions {
  organizationId: string;
  projectName: string;
  logName: string;
  lines: { runId: string }[];
  staleTime: number;
}

interface ProgressiveQueryResult {
  data: MetricDataPoint[] | undefined;
  isLoading: boolean;
  isError: boolean;
}

/**
 * Hybrid progressive loading hook for multi-run charts.
 *
 * Uses the best strategy for each tier:
 * - Tier 1 (Preview): Batch graphBatch query (1k pts/run, fast LIMIT)
 *   → 1 query for all runs, instant chart shapes
 * - Tier 2 (Standard): Individual graph queries (10k pts/run, Redis+IndexedDB cached)
 *   → Benefits from server-side Redis cache and client-side IndexedDB
 *
 * For 50 runs × 7 charts, initial load fires:
 * - 7 batch preview queries (fast, ~1s each)
 * - 350 individual standard queries (most cached, parallelized by browser)
 *
 * The preview gives instant visual feedback while standard data loads.
 */
export function useProgressiveMultiBatchQueries({
  organizationId,
  projectName,
  logName,
  lines,
  staleTime,
}: ProgressiveMultiBatchOptions): ProgressiveQueryResult[] {
  const runIds = useMemo(() => lines.map((l) => l.runId), [lines]);

  // === Tier 2: Standard individual queries (10k pts/run, Redis+IndexedDB cached) ===
  // Individual queries benefit from server-side Redis cache (withCache) and
  // client-side IndexedDB cache (useLocalQueries), making them faster than
  // batch for the standard tier.
  const standardQueries = useLocalQueries<MetricDataPoint>(
    lines.map((line) => {
      const opts = {
        organizationId,
        projectName,
        runId: line.runId,
        logName,
      };
      const queryOptions = trpc.runs.data.graph.queryOptions(opts);
      return {
        queryKey: queryOptions.queryKey,
        queryFn: () => trpcClient.runs.data.graph.query(opts),
        staleTime,
        gcTime: 0,
        localCache: metricsCache,
        enabled: true,
      };
    }),
  );

  // Check if any standard data has arrived
  const hasAnyStandard = standardQueries.some(
    (q) => q.data !== undefined && q.data.length > 0,
  );

  // === Tier 1: Batch preview (1k pts/run, fast LIMIT) ===
  // Fires a single query for all runs — provides instant chart shapes
  // while individual standard queries load. Disabled once standard data arrives.
  const previewOpts = useMemo(
    () => ({
      organizationId,
      projectName,
      logName,
      runIds,
      maxPoints: PREVIEW_MAX_POINTS,
      preview: true,
    }),
    [organizationId, projectName, logName, runIds],
  );

  const previewQuery = useQuery({
    queryKey: [
      ...trpc.runs.data.graphBatch.queryOptions(previewOpts).queryKey,
      "preview",
    ],
    queryFn: () => trpcClient.runs.data.graphBatch.query(previewOpts),
    staleTime: Infinity,
    gcTime: 0,
    enabled: runIds.length > 0 && !hasAnyStandard,
  });

  const previewData = previewQuery.data as
    | Record<string, MetricDataPoint[]>
    | undefined;

  // === Select best available data per run ===
  return useMemo((): ProgressiveQueryResult[] => {
    return lines.map((line, i) => {
      const runId = line.runId;
      const stdData = standardQueries[i]?.data;
      const prevPoints = previewData?.[runId];

      let data: MetricDataPoint[] | undefined;
      if (stdData && stdData.length > 0) {
        data = stdData;
      } else if (prevPoints && prevPoints.length > 0) {
        data = prevPoints;
      }

      return {
        data,
        isLoading:
          data === undefined &&
          (standardQueries[i]?.isLoading || previewQuery.isLoading),
        isError: standardQueries[i]?.isError ?? false,
      };
    });
  }, [lines, standardQueries, previewData, previewQuery.isLoading]);
}
