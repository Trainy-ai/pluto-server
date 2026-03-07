import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { trpc, trpcClient } from "@/utils/trpc";
import type { BucketedChartDataPoint } from "@/lib/chart-data-utils";
import { estimateStandardBuckets, PREVIEW_BUCKETS } from "@/lib/chart-bucket-estimate";

export type ProgressiveTier = "loading" | "preview" | "standard";

interface UseProgressiveGraphResult {
  /** Best available data: standard > preview */
  data: BucketedChartDataPoint[] | undefined;
  /** Current quality tier */
  tier: ProgressiveTier;
  isLoading: boolean;
  isError: boolean;
}

/**
 * Progressive chart loading hook using server-side bucketed downsampling.
 *
 * Two tiers:
 * 1. Preview (200 buckets) — instant visual feedback
 * 2. Standard (1000 buckets) — full-quality overview with min/max envelopes
 *
 * No full-resolution tier needed: bucket envelopes capture the data range,
 * and zoom re-buckets the visible range for higher fidelity.
 */
export function useProgressiveGraph(
  orgId: string,
  projectName: string,
  runId: string,
  logName: string,
): UseProgressiveGraphResult {
  // Compute once on mount — changing bucket count changes query key, so avoid recomputing
  const standardBuckets = useMemo(() => estimateStandardBuckets(), []);

  // === Tier 2: Standard (screen-aware buckets) ===
  const standardOpts = {
    organizationId: orgId,
    projectName,
    runId,
    logName,
    buckets: standardBuckets,
  };

  const standardQuery = useQuery({
    ...trpc.runs.data.graphBucketed.queryOptions(standardOpts),
    staleTime: 1000 * 5,
  });

  const standardData = standardQuery.data as BucketedChartDataPoint[] | undefined;
  const hasStandard = standardData !== undefined && standardData.length > 0;

  // === Tier 1: Preview (200 buckets, fast) ===
  // Only fires when we don't have standard data yet
  const previewOpts = {
    organizationId: orgId,
    projectName,
    runId,
    logName,
    buckets: PREVIEW_BUCKETS,
    preview: true,
  };

  const previewQuery = useQuery({
    queryKey: [...trpc.runs.data.graphBucketed.queryOptions(previewOpts).queryKey, "preview"],
    queryFn: () => trpcClient.runs.data.graphBucketed.query(previewOpts),
    staleTime: Infinity,
    gcTime: 0,
    enabled: !hasStandard,
  });

  const previewData = previewQuery.data as BucketedChartDataPoint[] | undefined;

  // === Select best available tier ===
  let data: BucketedChartDataPoint[] | undefined;
  let tier: ProgressiveTier;

  if (hasStandard) {
    data = standardData;
    tier = "standard";
  } else if (previewData && previewData.length > 0) {
    data = previewData;
    tier = "preview";
  } else {
    data = undefined;
    tier = "loading";
  }

  return {
    data,
    tier,
    isLoading: tier === "loading",
    isError: standardQuery.isError,
  };
}
