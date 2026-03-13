import { trpc } from "@/utils/trpc";
import { useQueries, useQuery } from "@tanstack/react-query";
import { useCallback, useMemo, useRef } from "react";

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
 *
 * runIds are sorted for a stable query key — when runs reorder (e.g., sort
 * change), the set of IDs stays the same so TanStack Query returns the
 * cached result instead of triggering an unnecessary refetch.
 */
export function useMetricSummaries(
  orgId: string,
  projectName: string,
  runIds: string[],
  metrics: { logName: string; aggregation: "MIN" | "MAX" | "AVG" | "LAST" | "VARIANCE" }[],
) {
  // Accumulator: keeps summaries from all previous fetches so pagination
  // never loses metric values for already-loaded runs.
  const accRef = useRef<Record<string, Record<string, number>>>({});

  // Track which metric specs the accumulator was built for.  When the user
  // adds/removes a metric column the accumulated data is stale and must be
  // discarded so we re-fetch everything with the new spec set.
  const metricsKeyRef = useRef<string>("");
  const metricsKey = useMemo(
    () => metrics.map((m) => `${m.logName}|${m.aggregation}`).sort().join(","),
    [metrics],
  );
  if (metricsKey !== metricsKeyRef.current) {
    accRef.current = {};
    metricsKeyRef.current = metricsKey;
  }

  // Only fetch IDs we haven't seen yet (incremental pagination).
  const newIds = useMemo(() => {
    const acc = accRef.current;
    return runIds.filter((id) => !acc[id]);
  }, [runIds]);

  // Sort for a stable query key.
  const sortedNewIds = useMemo(() => [...newIds].sort(), [newIds]);

  const query = useQuery(
    trpc.runs.metricSummaries.queryOptions(
      {
        organizationId: orgId,
        projectName,
        runIds: sortedNewIds,
        metrics,
      },
      {
        enabled: sortedNewIds.length > 0 && metrics.length > 0,
        staleTime: 30 * 1000,
      },
    )
  );

  // Merge new results into the accumulator.
  if (query.data?.summaries) {
    const fresh = query.data.summaries;
    const acc = accRef.current;
    for (const [id, vals] of Object.entries(fresh)) {
      acc[id] = vals;
    }
  }

  // Return the accumulated map in the same shape callers expect.
  // Wrap in a stable reference that only changes when the accumulator content
  // changes (new data arrived or metrics key changed).
  const summaries = accRef.current;
  const summariesSnapshot = useMemo(
    () => ({ summaries: { ...summaries } }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [query.data, metricsKey],
  );

  return { data: summariesSnapshot, isLoading: query.isLoading, isFetching: query.isFetching };
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
