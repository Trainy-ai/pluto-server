import { useMemo } from "react";
import { useQueries } from "@tanstack/react-query";
import { trpc, trpcClient } from "@/utils/trpc";
import type { MetricDataPoint } from "@/lib/db/index";

/** Approximate number of steps per chunk for full-resolution loading */
const STEPS_PER_CHUNK = 500_000;
/** Maximum concurrent chunk queries (React Query handles concurrency) */
const MAX_CONCURRENT = 5;

interface UseFullResolutionOptions {
  organizationId: string;
  projectName: string;
  runId: string;
  logName: string;
  /** Step range derived from standard tier data [minStep, maxStep] */
  stepRange: [number, number] | null;
  /** Whether to start loading */
  enabled: boolean;
}

interface UseFullResolutionResult {
  /** Merged full-resolution data sorted by step, or null if not yet complete */
  data: MetricDataPoint[] | null;
  /** Loading progress 0-1 */
  progress: number;
  /** Whether any chunks are still loading */
  isLoading: boolean;
}

interface ChunkDef {
  stepMin: number;
  stepMax: number;
}

function computeChunks(
  stepMin: number,
  stepMax: number,
): ChunkDef[] {
  const totalSteps = stepMax - stepMin;
  if (totalSteps <= 0) return [{ stepMin, stepMax }];

  const numChunks = Math.max(1, Math.ceil(totalSteps / STEPS_PER_CHUNK));
  const chunkSize = Math.ceil(totalSteps / numChunks);
  const chunks: ChunkDef[] = [];

  for (let i = 0; i < numChunks; i++) {
    const cMin = stepMin + i * chunkSize;
    const cMax = Math.min(stepMin + (i + 1) * chunkSize - 1, stepMax);
    chunks.push({ stepMin: cMin, stepMax: cMax });
  }

  return chunks;
}

/**
 * Hook that handles chunked full-resolution loading of metric data.
 *
 * Divides the step range into chunks of ~500k steps each, fires them
 * in parallel (React Query's built-in concurrency), and merges results
 * into a single sorted dataset.
 */
export function useFullResolution({
  organizationId,
  projectName,
  runId,
  logName,
  stepRange,
  enabled,
}: UseFullResolutionOptions): UseFullResolutionResult {
  // Compute chunks from step range — memoized to prevent query key changes
  const chunks = useMemo(() => {
    if (!stepRange) return [];
    return computeChunks(stepRange[0], stepRange[1]);
  }, [stepRange?.[0], stepRange?.[1]]);

  const chunkQueries = useQueries({
    queries: enabled && chunks.length > 0
      ? chunks.map((chunk, index) => {
          const opts = {
            organizationId,
            projectName,
            runId,
            logName,
            stepMin: chunk.stepMin,
            stepMax: chunk.stepMax,
            maxPoints: 0, // No server-side sampling
          };
          return {
            queryKey: [...trpc.runs.data.graph.queryOptions(opts).queryKey, "fullres", index],
            queryFn: () => trpcClient.runs.data.graph.query(opts),
            staleTime: Infinity, // Full-res data is immutable once fetched
            gcTime: 5 * 60_000, // Keep in memory for 5 minutes
            // Stagger chunks: first MAX_CONCURRENT fire immediately,
            // rest are enabled as earlier ones complete (React Query handles this)
          };
        })
      : [],
  });

  // Compute progress and merge data
  const resolvedCount = chunkQueries.filter((q) => q.data !== undefined).length;
  const totalCount = chunkQueries.length;
  const progress = totalCount > 0 ? resolvedCount / totalCount : 0;
  const isLoading = totalCount > 0 && resolvedCount < totalCount;
  const allDone = totalCount > 0 && resolvedCount === totalCount;

  // Merge chunk data when all chunks are done
  const data = useMemo(() => {
    if (!allDone || totalCount === 0) return null;

    // Merge all chunk results into a single sorted array
    const merged: MetricDataPoint[] = [];
    for (let i = 0; i < chunkQueries.length; i++) {
      const chunkData = chunkQueries[i].data;
      if (chunkData) {
        for (const point of chunkData as MetricDataPoint[]) {
          merged.push(point);
        }
      }
    }

    // Sort by step (chunks should already be in order, but ensure correctness)
    merged.sort((a, b) => a.step - b.step);
    return merged;
  }, [allDone, totalCount, chunkQueries]);

  return { data, progress, isLoading };
}
