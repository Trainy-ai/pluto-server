import { useMemo } from "react";
import type { inferOutput } from "@trpc/tanstack-react-query";
import { trpc, trpcClient } from "@/utils/trpc";
import { useRunBatchAccumulator } from "@/hooks/use-run-batch-accumulator";
import type { MetricData } from "../types";

export interface NormalizedHistogramData {
  globalMaxFreq: number;
  xAxisRange: {
    min: number;
    max: number;
    globalMin: number;
    globalMax: number;
  };
  normalizedData: any[];
}

// Per-run payload from the batched proc (keyed by runId): { rows, truncated, totalSteps }.
type HistogramBatchOutput = inferOutput<typeof trpc.runs.data.histogramBatch>;
type HistogramRunResult = HistogramBatchOutput[string];

export function useNormalizedHistogramData(
  runs: MetricData[],
  {
    tenantId,
    projectName,
    logName,
  }: { tenantId: string; projectName: string; logName: string },
): { data: NormalizedHistogramData; isLoading: boolean; hasError: boolean } {
  const selectedRunIds = useMemo(() => runs.map((run) => run.runId), [runs]);

  // Batched + incremental fetch. Replaces the previous per-run useQueries
  // fan-out (one runs.data.histogram per run) — which bloated the batched GET
  // URL into 414s — with ONE histogramBatch request for all runs, and only the
  // delta (newly-added runs) on a selection change. See useRunBatchAccumulator.
  const { data: byRun, isLoading, isError } =
    useRunBatchAccumulator<HistogramRunResult>({
      selectedRunIds,
      // Switching the metric (or project/tenant) resets the accumulator.
      wipeKey: `${tenantId}|${projectName}|${logName}`,
      queryKeyBase: ["runs.data.histogramBatch", tenantId, projectName, logName],
      fetchMissing: (missingRunIds) =>
        trpcClient.runs.data.histogramBatch.query({
          organizationId: tenantId,
          projectName,
          logName,
          runIds: missingRunIds,
        }),
      enabled: selectedRunIds.length > 0 && (logName?.length ?? 0) > 0,
    });

  const hasError = isError;

  const normalizedData = useMemo(() => {
    if (isLoading || hasError) {
      return {
        globalMaxFreq: 0,
        xAxisRange: { min: 0, max: 1, globalMin: 0, globalMax: 1 },
        normalizedData: [],
      };
    }

    // W&B-style: pass each step's histogram through UNCHANGED. We don't re-bin
    // to a shared uniform grid — every step keeps its native bin edges
    // (bins.min, bins.max, bins.num, freq[]) and its logged maxFreq. The
    // canvases map per-step bin positions onto a shared X axis at draw time, so
    // the visual stays comparable across rows / runs without rewriting the data.
    //
    // The only cross-run aggregates we compute are xAxisRange (union of all
    // bins.min/max + 10% buffer) and globalMaxFreq (max bin freq across runs).
    const runHistograms = runs.map((run) => ({
      runId: run.runId,
      runName: run.runName,
      color: run.color,
      data: byRun[run.runId]?.rows ?? [],
    }));

    let globalMin = Infinity;
    let globalMax = -Infinity;
    let globalMaxFreq = 0;

    for (const run of runHistograms) {
      for (const step of run.data) {
        const { bins, freq } = step.histogramData;
        if (bins.min < globalMin) globalMin = bins.min;
        if (bins.max > globalMax) globalMax = bins.max;
        for (const f of freq) {
          if (f > globalMaxFreq) globalMaxFreq = f;
        }
      }
    }

    if (!Number.isFinite(globalMin) || !Number.isFinite(globalMax)) {
      globalMin = 0;
      globalMax = 1;
    }
    const rangeBuffer = (globalMax - globalMin) * 0.1;

    return {
      globalMaxFreq,
      xAxisRange: {
        min: globalMin - rangeBuffer,
        max: globalMax + rangeBuffer,
        globalMin,
        globalMax,
      },
      normalizedData: runHistograms,
    };
  }, [runs, byRun, isLoading, hasError]);

  return { data: normalizedData, isLoading, hasError };
}
