import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { trpc, trpcClient } from "@/utils/trpc";
import type { MetricDataPoint } from "@/lib/db/index";
import { metricsCache } from "@/lib/db/index";
import { useLocalQuery } from "@/lib/hooks/use-local-query";
import { useFullResolution } from "@/lib/hooks/use-full-resolution";

/** Threshold: if standard tier returns >= this many points, data was sampled */
const SAMPLING_THRESHOLD = 9_000;
/** Preview tier point limit */
const PREVIEW_MAX_POINTS = 1_000;

export type ProgressiveTier = "loading" | "preview" | "standard" | "full";

interface UseProgressiveGraphResult {
  /** Best available data: full > standard > preview */
  data: MetricDataPoint[] | undefined;
  /** Current quality tier */
  tier: ProgressiveTier;
  /** Progress for full tier loading (0-1) */
  fullProgress: number;
  isLoading: boolean;
  isError: boolean;
  /** Whether data was sampled (standard tier hit the limit) */
  isSampled: boolean;
}

/**
 * Progressive chart loading hook — renders a coarse preview instantly,
 * upgrades to standard quality, then progressively loads ALL data points
 * for pixel-perfect zoom without server round-trips.
 *
 * Three tiers:
 * 1. Preview (500 pts) — instant visual feedback
 * 2. Standard (10k pts) — cached in IndexedDB, good overview
 * 3. Full (all pts, up to 10M) — loaded in chunks after standard resolves
 */
export function useProgressiveGraph(
  orgId: string,
  projectName: string,
  runId: string,
  logName: string,
): UseProgressiveGraphResult {
  // === Tier 2: Standard (10k points, IndexedDB cached) ===
  // This is the existing useGetGraph query — always fires
  const standardQuery = useLocalQuery<MetricDataPoint[]>({
    queryKey: trpc.runs.data.graph.queryKey({
      organizationId: orgId,
      projectName,
      runId,
      logName,
    }),
    queryFn: () =>
      trpcClient.runs.data.graph.query({
        organizationId: orgId,
        projectName,
        runId,
        logName,
      }),
    localCache: metricsCache,
    staleTime: 1000 * 5,
  });

  const standardData = standardQuery.data as MetricDataPoint[] | undefined;
  const hasStandard = standardData !== undefined && standardData.length > 0;

  // === Tier 1: Preview (500 points, fast LIMIT query) ===
  // Only fires when we don't have standard data yet (no IndexedDB cache hit)
  const previewOpts = {
    organizationId: orgId,
    projectName,
    runId,
    logName,
    maxPoints: PREVIEW_MAX_POINTS,
    preview: true, // Use fast LIMIT path (no reservoir sampling)
  };

  const previewQuery = useQuery({
    queryKey: [...trpc.runs.data.graph.queryOptions(previewOpts).queryKey, "preview"],
    queryFn: () => trpcClient.runs.data.graph.query(previewOpts),
    staleTime: Infinity,
    gcTime: 0, // Discard immediately once standard is available
    enabled: !hasStandard, // Skip if standard data already available (IndexedDB hit)
  });

  const previewData = previewQuery.data as MetricDataPoint[] | undefined;

  // === Tier 3: Full resolution (chunked, all points) ===
  // Detect if standard data was sampled (near the 10k cap)
  const isSampled = hasStandard && standardData.length >= SAMPLING_THRESHOLD;

  // Compute step range from standard data for chunk boundaries
  const stepRange = useMemo<[number, number] | null>(() => {
    if (!isSampled || !standardData || standardData.length === 0) return null;
    const steps = standardData.map((d) => d.step);
    return [Math.min(...steps), Math.max(...steps)];
  }, [isSampled, standardData]);

  const fullRes = useFullResolution({
    organizationId: orgId,
    projectName,
    runId,
    logName,
    stepRange,
    enabled: isSampled,
  });

  // === Select best available tier ===
  const hasFullData = fullRes.data !== null && fullRes.data.length > 0;

  let data: MetricDataPoint[] | undefined;
  let tier: ProgressiveTier;

  if (hasFullData) {
    data = fullRes.data!;
    tier = "full";
  } else if (hasStandard) {
    data = standardData;
    tier = "standard";
  } else if (previewData && previewData.length > 0) {
    data = previewData as MetricDataPoint[];
    tier = "preview";
  } else {
    data = undefined;
    tier = "loading";
  }

  return {
    data,
    tier,
    fullProgress: fullRes.progress,
    isLoading: tier === "loading",
    isError: standardQuery.isError,
    isSampled,
  };
}
