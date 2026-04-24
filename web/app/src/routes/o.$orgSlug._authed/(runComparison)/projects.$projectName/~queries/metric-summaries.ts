import { trpc } from "@/utils/trpc";
import { useQueries, useQuery } from "@tanstack/react-query";
import { useCallback, useMemo, useRef } from "react";

const METRIC_AGGS = ["MIN", "MAX", "AVG", "LAST", "VARIANCE"] as const;

/**
 * Fetch distinct metric names in a project (for the column picker "Metrics" group).
 */
export function useDistinctMetricNames(orgId: string, projectName: string) {
  return useQuery(
    trpc.runs.distinctMetricNames.queryOptions(
      {
        organizationId: orgId,
        projectName,
      },
      {
        staleTime: 30_000,
      },
    )
  );
}

/**
 * Fetch distinct metric names scoped to specific runs (for side-by-side view).
 * Returns ALL metric names for the given runs — no limit.
 * By default uses the fast summaries table; set includeNonFiniteMetrics=true
 * to include metrics whose values are all NaN/Inf (slower).
 */
export function useRunMetricNames(orgId: string, projectName: string, runIds: string[], includeNonFiniteMetrics?: boolean) {
  return useQuery(
    trpc.runs.distinctMetricNames.queryOptions(
      {
        organizationId: orgId,
        projectName,
        runIds,
        ...(includeNonFiniteMetrics ? { includeNonFiniteMetrics } : {}),
      },
      {
        enabled: runIds.length > 0,
        staleTime: 30_000,
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

// Re-export the pure wipe predicate so existing imports of
// useMetricSummaries can pull it from the same module path. The actual
// implementation lives in metric-summaries-cache.ts so it can be unit
// tested without dragging in @/utils/trpc (which initializes env).
export { metricSpecRequiresWipe } from "./metric-summaries-cache";
import { metricSpecRequiresWipe } from "./metric-summaries-cache";

/**
 * Batch fetch metric summaries for visible runs.
 * Used by the run table for metric columns (small, known set of specs).
 *
 * runIds are sorted for a stable query key — when runs reorder (e.g., sort
 * change), the set of IDs stays the same so TanStack Query returns the
 * cached result instead of triggering an unnecessary refetch.
 *
 * Returns:
 *   data.summaries     — accumulated Record<runId, Record<"logName|AGG", number>>
 *   loadedRunIds       — Set of run IDs the accumulator currently has data
 *                        for. Cells use this to distinguish "value missing
 *                        because we haven't fetched yet" (show skeleton)
 *                        from "value missing because the run truly has none"
 *                        (show "-").
 *   isLoading/isFetching from the underlying query.
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

  // Separate tracker for which runIds have completed a fetch under the
  // current metric set. Decoupled from `accRef` because the accumulator
  // only sees runs the server returned data for — runs with no values
  // for any of the requested metrics aren't in `accRef` at all, but they
  // ARE "loaded" (we asked, the server said nothing). Cells use this set
  // to decide whether to render the loading skeleton or "-".
  const fetchedRunIdsRef = useRef<Set<string>>(new Set());

  // Track which metric specs the accumulator was built for. We only wipe
  // when a NEW metric is added — pure removals keep the cached values, so
  // re-adding a removed column is instant and removing alone never
  // triggers a refetch.
  const prevMetricsSetRef = useRef<ReadonlySet<string>>(new Set());
  const currentMetricsSet = useMemo(
    () => new Set(metrics.map((m) => `${m.logName}|${m.aggregation}`)),
    [metrics],
  );
  if (metricSpecRequiresWipe(prevMetricsSetRef.current, currentMetricsSet)) {
    accRef.current = {};
    fetchedRunIdsRef.current = new Set();
  }
  prevMetricsSetRef.current = currentMetricsSet;

  // Compute missing runIds inline (not via useMemo). Recomputed every
  // render so it reflects the current ref state, not a stale memoized
  // snapshot. A run is "missing" iff we haven't completed a fetch for it
  // under the current metric set. Without this the query would stay
  // enabled after a metric change and TanStack Query would fire a fetch
  // on every queryKey change (any add OR remove changes the key, since
  // `metrics` is part of the input).
  const fetched = fetchedRunIdsRef.current;
  const missingRunIds: string[] = [];
  for (const id of runIds) {
    if (!fetched.has(id)) missingRunIds.push(id);
  }
  missingRunIds.sort();

  const query = useQuery(
    trpc.runs.metricSummaries.queryOptions(
      {
        organizationId: orgId,
        projectName,
        runIds: missingRunIds,
        metrics,
      },
      {
        enabled: missingRunIds.length > 0 && metrics.length > 0,
        staleTime: 30 * 1000,
      },
    )
  );

  // Merge fetch results. Two pieces of state to update:
  //   - `accRef`: actual values (only for runs the server returned).
  //   - `fetchedRunIdsRef`: every runId we ASKED about, regardless of
  //     whether the server returned anything. This is what keeps cells
  //     for runs-with-no-values from being stuck in the loading skeleton
  //     state forever and what prevents an endless fetch loop on those
  //     runs.
  if (query.data?.summaries) {
    const fresh = query.data.summaries;
    const acc = accRef.current;
    for (const [id, vals] of Object.entries(fresh)) {
      acc[id] = { ...acc[id], ...vals };
    }
    for (const id of missingRunIds) {
      fetchedRunIdsRef.current.add(id);
    }
  }

  // Return the accumulated map in the same shape callers expect.
  // Wrap in a stable reference that only changes when the accumulator content
  // changes (new data arrived or metrics-set changed).
  const summaries = accRef.current;
  const summariesSnapshot = useMemo(
    () => ({ summaries: { ...summaries } }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [query.data, currentMetricsSet],
  );

  // loadedRunIds reflects "we've asked about this run" not "we have data
  // for this run". Cells need the former to know when to stop showing the
  // loading skeleton.
  const loadedRunIds = useMemo(
    () => new Set(fetchedRunIdsRef.current),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [query.data, currentMetricsSet],
  );

  return {
    data: summariesSnapshot,
    loadedRunIds,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
  };
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

  // Per-metric loading state — used by the UI to show skeletons instead of
  // "-" while a newly-expanded metric is still fetching from the server.
  const loadingByMetric = useMemo(() => {
    const map: Record<string, boolean> = {};
    expandedMetricNames.forEach((name, i) => {
      const q = queries[i];
      map[name] = !!q && (q.isPending || (q.isFetching && !q.data));
    });
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expandedMetricNames, queries.map((q) => `${q.isPending}:${q.isFetching}:${!!q.data}`).join("|")]);

  return { summaries, loadingByMetric };
}
