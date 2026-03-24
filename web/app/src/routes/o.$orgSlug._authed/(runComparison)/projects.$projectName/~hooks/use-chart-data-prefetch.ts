import { useEffect, useMemo, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { trpc, trpcClient } from "@/utils/trpc";
import { PREVIEW_BUCKETS } from "@/lib/chart-bucket-estimate";

// Cap prefetch to avoid overwhelming the network when runs have many metrics.
// 50 covers the typical "All Metrics" view (9-20 charts) with headroom.
const MAX_PREFETCH_METRICS = 50;

/**
 * Prefetch chart data for URL-specified runs.
 *
 * When the URL contains `?runs=id1,id2`, we know which runs to chart before
 * the full getLogsByRunIds → groupMetrics chain completes. This hook fires
 * `distinctMetricNames` immediately, then prefetches `graphBatchBucketed`
 * (preview tier) for each metric. By the time charts mount, the TanStack
 * Query cache already has data → instant render.
 */
export function useChartDataPrefetch(
  organizationId: string,
  projectName: string,
  rawUrlRunIds: string[] | undefined,
) {
  const queryClient = useQueryClient();
  const prefetchedRef = useRef<string | null>(null);

  // Stable run IDs key to detect changes
  const runIdsKey = useMemo(
    () => (rawUrlRunIds ? rawUrlRunIds.slice().sort().join(",") : null),
    [rawUrlRunIds],
  );

  // Fire distinctMetricNames scoped to the URL run IDs — fast ClickHouse prefix scan
  const { data: metricNamesData } = useQuery(
    trpc.runs.distinctMetricNames.queryOptions(
      {
        organizationId,
        projectName,
        runIds: rawUrlRunIds ?? [],
      },
      {
        enabled: !!rawUrlRunIds?.length,
        staleTime: 5 * 60 * 1000,
      },
    ),
  );

  const metricNames = metricNamesData?.metricNames;

  // Once metric names arrive, prefetch graphBatchBucketed (preview tier) for each.
  // Uses the exact same query key as MultiLineChart's preview queries so TanStack
  // Query deduplicates: charts mount → cache hit → no redundant fetch.
  useEffect(() => {
    if (!metricNames?.length || !rawUrlRunIds?.length) return;
    // Only prefetch once per set of run IDs
    if (prefetchedRef.current === runIdsKey) return;
    prefetchedRef.current = runIdsKey;

    for (const metric of metricNames.slice(0, MAX_PREFETCH_METRICS)) {
      const opts = {
        organizationId,
        projectName,
        logName: metric,
        runIds: rawUrlRunIds,
        buckets: PREVIEW_BUCKETS,
        preview: true as const,
      };

      queryClient.prefetchQuery({
        queryKey: [
          ...trpc.runs.data.graphBatchBucketed.queryOptions(opts).queryKey,
          "preview",
        ],
        queryFn: ({ signal }) =>
          trpcClient.runs.data.graphBatchBucketed.query(opts, { signal }),
        staleTime: Infinity,
      });
    }
  }, [metricNames, rawUrlRunIds, runIdsKey, organizationId, projectName, queryClient]);
}
