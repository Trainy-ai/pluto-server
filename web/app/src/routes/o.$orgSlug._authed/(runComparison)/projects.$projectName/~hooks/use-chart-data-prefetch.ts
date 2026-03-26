import { useEffect, useMemo, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { trpc, trpcClient } from "@/utils/trpc";
import { PREVIEW_BUCKETS } from "@/lib/chart-bucket-estimate";
import { MULTI_METRIC_CHUNK, chunkArray } from "@/lib/chart-data-utils";

/**
 * Prefetch chart data for URL-specified runs.
 *
 * When the URL contains `?runs=id1,id2`, we know which runs to chart before
 * the full getLogsByRunIds → groupMetrics chain completes. This hook fires
 * `distinctMetricNames` immediately, then prefetches chart data using the
 * same multi-metric batch endpoint and query keys as the chart component.
 * TanStack Query deduplicates: charts mount → cache hit → no redundant fetch.
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

  // Once metric names arrive, prefetch using the same multi-metric batch
  // endpoint and chunking as line-chart-multi.tsx so query keys match.
  useEffect(() => {
    if (!metricNames?.length || !rawUrlRunIds?.length) return;
    if (prefetchedRef.current === runIdsKey) return;
    prefetchedRef.current = runIdsKey;

    const chunks = chunkArray(metricNames, MULTI_METRIC_CHUNK);
    for (const chunk of chunks) {
      const opts = {
        organizationId,
        projectName,
        logNames: chunk,
        runIds: rawUrlRunIds,
        buckets: PREVIEW_BUCKETS,
        preview: true as const,
      };

      queryClient.prefetchQuery({
        queryKey: [
          ...trpc.runs.data.graphMultiMetricBatchBucketed.queryOptions(opts).queryKey,
          "preview",
        ],
        queryFn: ({ signal }) =>
          trpcClient.runs.data.graphMultiMetricBatchBucketed.query(opts, { signal }),
        staleTime: Infinity,
      });
    }
  }, [metricNames, rawUrlRunIds, runIdsKey, organizationId, projectName, queryClient]);
}
