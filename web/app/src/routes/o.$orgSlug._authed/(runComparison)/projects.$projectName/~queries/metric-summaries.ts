import { trpc } from "@/utils/trpc";
import { useQueries, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

const METRIC_AGGS = ["MIN", "MAX", "AVG", "LAST", "VARIANCE"] as const;

/**
 * Fetch distinct metric names in a project (for the column picker "Metrics" group).
 */
export function useDistinctMetricNames(orgId: string, projectName: string) {
  return useQuery(
    trpc.runs.distinctMetricNames.queryOptions({
      organizationId: orgId,
      projectName,
    })
  );
}

/**
 * Fetch distinct metric names scoped to specific runs (for side-by-side view).
 * Returns ALL metric names for the given runs — no limit.
 */
export function useRunMetricNames(orgId: string, projectName: string, runIds: string[]) {
  return useQuery(
    trpc.runs.distinctMetricNames.queryOptions(
      {
        organizationId: orgId,
        projectName,
        runIds,
      },
      {
        enabled: runIds.length > 0,
      },
    )
  );
}

/**
 * Search metric names server-side. Only fires when search is non-empty.
 */
export function useSearchMetricNames(orgId: string, projectName: string, search: string) {
  return useQuery(
    trpc.runs.distinctMetricNames.queryOptions(
      {
        organizationId: orgId,
        projectName,
        search,
      },
      {
        enabled: search.length > 0,
        staleTime: 60 * 1000,
        placeholderData: (prev) => prev,
      },
    )
  );
}

/**
 * Search metric names server-side using regex (ClickHouse re2 engine).
 * Only fires when regex is non-empty and valid.
 */
export function useRegexSearchMetricNames(orgId: string, projectName: string, regex: string) {
  return useQuery(
    trpc.runs.distinctMetricNames.queryOptions(
      {
        organizationId: orgId,
        projectName,
        regex,
      },
      {
        enabled: regex.length > 0,
        staleTime: 60 * 1000,
        placeholderData: (prev) => prev,
      },
    )
  );
}

/**
 * Batch fetch metric summaries for visible runs.
 * Used by the run table for metric columns (small, known set of specs).
 */
export function useMetricSummaries(
  orgId: string,
  projectName: string,
  runIds: string[],
  metrics: { logName: string; aggregation: "MIN" | "MAX" | "AVG" | "LAST" | "VARIANCE" }[],
) {
  return useQuery(
    trpc.runs.metricSummaries.queryOptions(
      {
        organizationId: orgId,
        projectName,
        runIds,
        metrics,
      },
      {
        enabled: runIds.length > 0 && metrics.length > 0,
        staleTime: 30 * 1000,
        placeholderData: (prev) => prev,
      },
    )
  );
}

/**
 * Fetch metric summaries one query per metric name.
 * Each expanded metric gets its own cached query, so expanding a new metric
 * only fetches the new one — previously expanded metrics are served from cache.
 * Used by the side-by-side view where metrics are lazily expanded.
 */
export function usePerMetricSummaries(
  orgId: string,
  projectName: string,
  runIds: string[],
  expandedMetricNames: string[],
) {
  const queries = useQueries({
    queries: expandedMetricNames.map((logName) =>
      trpc.runs.metricSummaries.queryOptions(
        {
          organizationId: orgId,
          projectName,
          runIds,
          metrics: METRIC_AGGS.map((agg) => ({ logName, aggregation: agg })),
        },
        {
          enabled: runIds.length > 0,
          staleTime: 30 * 1000,
        },
      )
    ),
  });

  // Merge all per-metric results into the same shape the component expects:
  // Record<runId, Record<"logName|AGG", number>>
  const summaries = useMemo(() => {
    const merged: Record<string, Record<string, number>> = {};
    for (const q of queries) {
      if (!q.data?.summaries) continue;
      for (const [runId, metrics] of Object.entries(q.data.summaries)) {
        if (!merged[runId]) merged[runId] = {};
        Object.assign(merged[runId], metrics);
      }
    }
    return merged;
  }, [queries]);

  return { summaries };
}
