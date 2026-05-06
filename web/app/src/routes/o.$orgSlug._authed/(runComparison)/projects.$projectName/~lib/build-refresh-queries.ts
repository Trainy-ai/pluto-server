import type { InvalidateQueryFilters, Query } from "@tanstack/react-query";

// tRPC v11 query keys look like: [path[], { input, type }]
// e.g. [["runs", "distinctMetricNames"], { input: {...}, type: "query" }]
function getPath(query: Query): readonly string[] | undefined {
  const first = query.queryKey?.[0];
  return Array.isArray(first) ? (first as string[]) : undefined;
}

// Build the queries list passed to useRefresh.
//
// Single filter: every runs.* query, refetchType "active". Active means
// "only refetch queries that still have a mounted observer". Queries whose
// key has changed because of input changes (e.g. selectedRunIds toggled,
// search term edited, page size flipped) become orphans with zero
// observers and sit in the cache until gc. Refetching those orphans on
// every tick produced a request-amplification fan-out: each runIds toggle
// minted ~20 new dynamic-section queries, and the previous ~20 (now
// orphaned) kept refetching for the full gcTime window — 30s of toggling
// could pin 100+ orphan queries to the auto-refresh cycle.
//
// Active observers cover everything currently rendered, including hidden
// tabs whose components are still mounted. The only case "active" misses
// is fully unmounted subtrees, which will refetch when their components
// remount and their stale data is observed again — that's the right
// behavior.
//
// Charts and side-by-side modes used to need different predicates: charts
// refetched everything with "all", side-by-side narrowed to specific
// procs because dashboard queries were orphans in that mode. Once both
// modes use "active", orphans are skipped automatically and the narrowing
// is moot. One filter, one predicate.
export function buildRefreshQueryFilters(): InvalidateQueryFilters[] {
  return [
    {
      predicate: (query) => getPath(query)?.[0] === "runs",
      refetchType: "active",
    },
  ];
}
