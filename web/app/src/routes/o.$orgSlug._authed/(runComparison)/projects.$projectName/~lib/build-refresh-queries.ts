import type { InvalidateQueryFilters, Query } from "@tanstack/react-query";

export type RunComparisonViewMode = "charts" | "side-by-side";

// tRPC v11 query keys look like: [path[], { input, type }]
// e.g. [["runs", "distinctMetricNames"], { input: {...}, type: "query" }]
function getPath(query: Query): readonly string[] | undefined {
  const first = query.queryKey?.[0];
  return Array.isArray(first) ? (first as string[]) : undefined;
}

function getInput(query: Query): Record<string, unknown> | undefined {
  const second = query.queryKey?.[1] as { input?: Record<string, unknown> } | undefined;
  return second?.input;
}

// Side-by-side view observes: runs.list (table, still visible), runs.count,
// runs.getByIds, runs.metricSummaries, runs.distinctTags, and the
// runIds-scoped variant of runs.distinctMetricNames (no regex/search).
// Dashboard-only queries (distinctFileLogNames, distinctMetricNames with
// regex/search, distinctColumnKeys) belong to the unmounted chart tree and
// must not be refetched on the auto-refresh tick.
export function isSideBySideQuery(query: Query): boolean {
  const path = getPath(query);
  if (path?.[0] !== "runs") return false;
  const sub = path[1];
  if (
    sub === "list" ||
    sub === "count" ||
    sub === "getByIds" ||
    sub === "metricSummaries" ||
    sub === "distinctTags"
  ) {
    return true;
  }
  if (sub === "distinctMetricNames") {
    const input = getInput(query);
    return !input?.regex && !input?.search;
  }
  return false;
}

// Build the queries list passed to useRefresh.
//
// runs.list uses refetchType "active" in both modes to avoid the pageSize
// zombie (stale cache entries with different limits all refetching on every
// tick, stacking concurrent backend requests).
//
// Charts mode: every other runs.* query refetches with "all" so hidden chart
// groups, dashboard widgets, diff view, etc. stay warm.
//
// Side-by-side mode: narrow to the queries side-by-side actually observes.
// The dashboard tree is unmounted, so its cached queries would otherwise be
// refetched anyway (refetchType "all" ignores whether there's an observer).
export function buildRefreshQueryFilters(
  viewMode: RunComparisonViewMode,
): InvalidateQueryFilters[] {
  const runsListFilter: InvalidateQueryFilters = {
    predicate: (query) => {
      const path = getPath(query);
      return path?.[0] === "runs" && path?.[1] === "list";
    },
    refetchType: "active",
  };

  if (viewMode === "side-by-side") {
    return [
      runsListFilter,
      {
        predicate: (query) => {
          const path = getPath(query);
          if (path?.[0] !== "runs" || path?.[1] === "list") return false;
          return isSideBySideQuery(query);
        },
        refetchType: "all",
      },
    ];
  }

  return [
    runsListFilter,
    {
      predicate: (query) => {
        const path = getPath(query);
        return path?.[0] === "runs" && path?.[1] !== "list";
      },
      refetchType: "all",
    },
  ];
}
