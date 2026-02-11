import { trpc, trpcClient } from "@/utils/trpc";
import { useInfiniteQuery, keepPreviousData } from "@tanstack/react-query";
import type { inferOutput } from "@trpc/tanstack-react-query";
import { RUNS_FETCH_LIMIT } from "../~components/runs-table/config";
import type { DateFilterParam, FieldFilterParam, MetricFilterParam, SystemFilterParam, SortParam } from "@/lib/run-filters";

// Define proper type for the list runs response
export type ListRunResponse = inferOutput<typeof trpc.runs.list>;
export type Run = ListRunResponse["runs"][number];

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
) => {
  const queryOptions = trpc.runs.list.infiniteQueryOptions({
    organizationId: orgId,
    projectName: projectName,
    limit: RUNS_FETCH_LIMIT,
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

  return useInfiniteQuery({
    queryKey: [...queryOptions.queryKey, { tags, status, search, dateFilters, sort, fieldFilters, metricFilters, systemFilters }],
    queryFn: async ({ pageParam }) => {
      const result = await trpcClient.runs.list.query({
        organizationId: orgId,
        projectName: projectName,
        limit: RUNS_FETCH_LIMIT,
        // Pagination param depends on mode
        ...(paginationMode === "cursor"
          ? { cursor: pageParam ? Number(pageParam) : undefined }
          : paginationMode === "keyset"
            ? { sortCursor: pageParam ? String(pageParam) : undefined }
            : { offset: pageParam ? Number(pageParam) : 0 }),
        tags: tags && tags.length > 0 ? tags : undefined,
        status: status && status.length > 0 ? status as ("RUNNING" | "COMPLETED" | "FAILED" | "TERMINATED" | "CANCELLED")[] : undefined,
        search: search && search.trim() ? search.trim() : undefined,
        dateFilters: dateFilters && dateFilters.length > 0 ? dateFilters : undefined,
        fieldFilters: fieldFilters && fieldFilters.length > 0 ? fieldFilters : undefined,
        metricFilters: metricFilters && metricFilters.length > 0 ? metricFilters : undefined,
        systemFilters: systemFilters && systemFilters.length > 0 ? systemFilters : undefined,
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
      if (paginationMode === "keyset") {
        return extended.sortCursor ?? undefined;
      }
      if (paginationMode === "offset") {
        return extended.nextOffset != null ? Number(extended.nextOffset) : undefined;
      }
      return lastPage.nextCursor ? Number(lastPage.nextCursor) : undefined;
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
