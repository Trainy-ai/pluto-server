import { trpc, trpcClient } from "@/utils/trpc";
import { useInfiniteQuery, type InfiniteData } from "@tanstack/react-query";
import type { inferOutput } from "@trpc/tanstack-react-query";
import { RUNS_FETCH_LIMIT } from "../~components/runs-table/config";
import { useLocalInfiniteQuery } from "@/lib/hooks/use-local-query";
import { LocalCache } from "@/lib/db/local-cache";

// Define proper type for the list runs response
export type ListRunResponse = inferOutput<typeof trpc.runs.list>;
export type Run = ListRunResponse["runs"][number];

// Initialize LocalCache for infinite query data
const runsCache = new LocalCache<InfiniteData<ListRunResponse>>(
  "runsCache",
  "runsCache",
  100 * 60 * 1000,
); // Adjust table name as needed

export const useListRuns = (orgId: string, projectName: string) => {
  const queryOptions = trpc.runs.list.infiniteQueryOptions({
    organizationId: orgId,
    projectName: projectName,
    limit: RUNS_FETCH_LIMIT,
  });

  // return useInfiniteQuery(queryOptions);

  return useInfiniteQuery({
    queryKey: queryOptions.queryKey,
    queryFn: async ({ pageParam }) => {
      const result = await trpcClient.runs.list.query({
        organizationId: orgId,
        projectName: projectName,
        limit: RUNS_FETCH_LIMIT,
        cursor: pageParam ? Number(pageParam) : undefined,
      });
      return result;
    },
    getNextPageParam: (lastPage: ListRunResponse) => {
      if (!lastPage) return undefined;
      return lastPage.nextCursor ? Number(lastPage.nextCursor) : undefined;
    },
    staleTime: 5 * 1000 * 60,
    initialPageParam: undefined,
    // localCache: runsCache,
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
