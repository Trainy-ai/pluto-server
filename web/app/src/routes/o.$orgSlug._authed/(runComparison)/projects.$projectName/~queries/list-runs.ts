import { trpc, trpcClient } from "@/utils/trpc";
import { useInfiniteQuery, keepPreviousData } from "@tanstack/react-query";
import type { inferOutput } from "@trpc/tanstack-react-query";
import { DEFAULT_PAGE_SIZE, RUNS_FETCH_LIMIT } from "../~components/runs-table/config";
import type { DateFilterParam, FieldFilterParam, MetricFilterParam, SystemFilterParam, SortParam } from "@/lib/run-filters";

// Define proper type for the list runs response
export type ListRunResponse = inferOutput<typeof trpc.runs.list>;
export type Run = ListRunResponse["runs"][number];

/** (source, key) pair identifying a config/systemMetadata field to include
 *  in the _flatConfig/_flatSystemMetadata blobs returned by runs.list.
 *  Kept narrow — matches the backend's VisibleColumn shape. */
export type VisibleColumn = { source: "config" | "systemMetadata"; key: string };

export const useListRuns = (
  orgId: string,
  projectName: string,
  tags?: string[],
  status?: string[],
  search?: string,
  dateFilters?: DateFilterParam[],
  sort?: SortParam,
  fieldFilters?: FieldFilterParam[],
  metricFilters?: MetricFilterParam[],
  systemFilters?: SystemFilterParam[],
  pageSize?: number,
  pageBase?: number,
  // When provided, server only includes these (source, key) pairs in the
  // flat field-value blobs on each row. [] → empty blobs (no keys).
  // omitted → legacy behavior (every key for every run; unbounded payload).
  visibleColumns?: VisibleColumn[],
) => {
  // Fetch at least 2x the display page size so clicking "next" always has data
  const fetchLimit = Math.max(pageSize ? pageSize * 2 : RUNS_FETCH_LIMIT, RUNS_FETCH_LIMIT);

  const queryOptions = trpc.runs.list.infiniteQueryOptions({
    organizationId: orgId,
    projectName: projectName,
    limit: fetchLimit,
    tags: tags && tags.length > 0 ? tags : undefined,
    status: status && status.length > 0 ? status as ("RUNNING" | "COMPLETED" | "FAILED" | "TERMINATED" | "CANCELLED")[] : undefined,
    search: search && search.trim() ? search.trim() : undefined,
    dateFilters: dateFilters && dateFilters.length > 0 ? dateFilters : undefined,
  });

  // Pagination strategy:
  // - No sort: cursor-based (existing createdAt DESC)
  // - System column sort: keyset cursor (sortCursor string)
  // - JSON field / metric sort: offset-based
  const paginationMode = !sort ? "cursor" : sort.source === "system" ? "keyset" : "offset";

  // When pageBase > 0, we jumped to a specific page. Use offset mode for all
  // pagination to avoid cursor/keyset dependencies on prior pages.
  const jumped = pageBase != null && pageBase > 0;
  const jumpOffset = jumped ? pageBase * (pageSize || DEFAULT_PAGE_SIZE) : 0;

  return useInfiniteQuery({
    // Include pageBase and visibleColumns in queryKey so each distinct
    // (filter + visible-column set) combination gets its own cache entry.
    queryKey: [...queryOptions.queryKey, { tags, status, search, dateFilters, sort, fieldFilters, metricFilters, systemFilters, pageBase: pageBase || 0, visibleColumns }],
    queryFn: async ({ pageParam }) => {
      // After a jump, all fetches use offset mode (no cursor/keyset dependency)
      const useOffsetMode = jumped;

      let paginationParams: Record<string, unknown> = {};

      if (useOffsetMode) {
        // First fetch after jump: use jumpOffset. Subsequent: use nextOffset from response.
        paginationParams = { offset: pageParam != null ? Number(pageParam) : jumpOffset };
      } else if (paginationMode === "cursor") {
        paginationParams = pageParam ? { cursor: Number(pageParam) } : {};
      } else if (paginationMode === "keyset") {
        paginationParams = pageParam ? { sortCursor: String(pageParam) } : {};
      } else {
        paginationParams = { offset: pageParam ? Number(pageParam) : 0 };
      }

      const result = await trpcClient.runs.list.query({
        organizationId: orgId,
        projectName: projectName,
        limit: fetchLimit,
        ...paginationParams,
        tags: tags && tags.length > 0 ? tags : undefined,
        status: status && status.length > 0 ? status as ("RUNNING" | "COMPLETED" | "FAILED" | "TERMINATED" | "CANCELLED")[] : undefined,
        search: search && search.trim() ? search.trim() : undefined,
        dateFilters: dateFilters && dateFilters.length > 0 ? dateFilters : undefined,
        fieldFilters: fieldFilters && fieldFilters.length > 0 ? fieldFilters : undefined,
        metricFilters: metricFilters && metricFilters.length > 0 ? metricFilters : undefined,
        systemFilters: systemFilters && systemFilters.length > 0 ? systemFilters : undefined,
        visibleColumns,
        // Sort params
        ...(sort ? {
          sortField: sort.field,
          sortSource: sort.source,
          sortDirection: sort.direction,
          ...(sort.source === "metric" && sort.aggregation ? { sortAggregation: sort.aggregation } : {}),
        } : {}),
      });
      return result;
    },
    getNextPageParam: (lastPage: ListRunResponse) => {
      if (!lastPage) return undefined;
      const extended = lastPage as any;
      // Response-driven pagination: check actual response fields rather than
      // the closure's paginationMode. This prevents stale placeholder data
      // (from keepPreviousData) being evaluated with the wrong mode during
      // sort transitions (e.g., cursor → offset).
      if (extended.sortCursor != null) {
        return String(extended.sortCursor);
      }
      if (extended.nextOffset != null) {
        return Number(extended.nextOffset);
      }
      if (lastPage.nextCursor) {
        return Number(lastPage.nextCursor);
      }
      return undefined;
    },
    staleTime: 5 * 1000 * 60,
    initialPageParam: undefined,
    placeholderData: keepPreviousData,
  });
};

export const prefetchListRuns = async (
  queryClient: any,
  orgId: string,
  projectName: string,
) => {
  await queryClient.prefetchInfiniteQuery({
    ...trpc.runs.list.infiniteQueryOptions({
      organizationId: orgId,
      projectName: projectName,
      limit: RUNS_FETCH_LIMIT,
    }),
    getNextPageParam: (lastPage: ListRunResponse) => {
      if (!lastPage) return undefined;
      // Convert bigint to number if it exists
      return lastPage.nextCursor ? Number(lastPage.nextCursor) : undefined;
    },
  });
};

export const invalidateListRuns = async (
  queryClient: any,
  orgId: string,
  projectName: string,
) => {
  await queryClient.invalidateQueries({
    queryKey: trpc.runs.list.infiniteQueryOptions({
      organizationId: orgId,
      projectName: projectName,
      limit: RUNS_FETCH_LIMIT,
    }).queryKey,
  });
};
