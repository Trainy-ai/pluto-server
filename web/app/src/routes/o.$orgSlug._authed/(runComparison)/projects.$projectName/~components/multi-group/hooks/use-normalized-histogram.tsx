import { useMemo } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { trpc } from "@/utils/trpc";
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

export function useNormalizedHistogramData(
  runs: MetricData[],
  {
    tenantId,
    projectName,
    logName,
  }: { tenantId: string; projectName: string; logName: string },
): { data: NormalizedHistogramData; isLoading: boolean; hasError: boolean } {
  // Create separate queries for each run
  const histogramQueries = useQueries({
    queries: runs.map((run) => ({
      ...trpc.runs.data.histogram.queryOptions({
        organizationId: tenantId,
        runId: run.runId,
        projectName,
        logName,
      }),
    })),
  });

  const isLoading = histogramQueries.some((q) => q.isLoading);
  const hasError = histogramQueries.some((q) => q.isError);

  const normalizedData = useMemo(() => {
    if (isLoading || hasError) {
      return {
        globalMaxFreq: 0,
        xAxisRange: { min: 0, max: 1, globalMin: 0, globalMax: 1 },
        normalizedData: [],
      };
    }

    // W&B-style: pass each step's histogram through UNCHANGED. We don't
    // re-bin to a shared uniform grid — every step keeps its native
    // bin edges (bins.min, bins.max, bins.num, freq[]) and its
    // logged maxFreq. The canvases (drawSingleHistogram,
    // drawRidgeline, drawHeatmap) all map per-step bin positions
    // onto a shared X axis at draw time, so the visual stays comparable
    // across rows / runs without rewriting the underlying data.
    //
    // The only cross-run aggregates we still compute are:
    //   xAxisRange — union of all bins.min/max plus a 10% buffer, used
    //     as the shared X domain in Step mode and as a fallback in
    //     Ridgeline/Heatmap when no explicit domain is supplied.
    //   globalMaxFreq — max of any bin's freq across every run/step,
    //     used to normalize ridge / cell heights to a comparable scale.
    const runHistograms = runs.map((run, index) => ({
      runId: run.runId,
      runName: run.runName,
      color: run.color,
      data: histogramQueries[index].data?.rows ?? [],
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
  }, [runs, histogramQueries, isLoading, hasError]);

  return { data: normalizedData, isLoading, hasError };
}
