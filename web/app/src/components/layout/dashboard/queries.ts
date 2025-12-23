import { queryClient, trpc, trpcClient } from "@/utils/trpc";
import { prefetchLocalQuery, useLocalQuery } from "@/lib/hooks/use-local-query";
import { LocalCache } from "@/lib/db/local-cache";
import type { inferOutput } from "@trpc/tanstack-react-query";

type LatestRunsData = inferOutput<typeof trpc.runs.latest>;

const latestRunsCache = new LocalCache<LatestRunsData>(
  "latestRuns",
  "latestRuns",
  1000 * 10,
);

const LIMIT = 10;

export const useLatestRuns = (orgId: string) =>
  useLocalQuery<LatestRunsData>({
    queryKey: trpc.runs.latest.queryKey(),
    queryFn: () =>
      trpcClient.runs.latest.query({
        organizationId: orgId,
        limit: LIMIT,
      }),
    localCache: latestRunsCache,
    staleTime: 1000 * 5,
  });

export const prefetchLatestRuns = (orgId: string) =>
  prefetchLocalQuery(queryClient, {
    queryKey: trpc.runs.latest.queryKey(),
    queryFn: () =>
      trpcClient.runs.latest.query({
        organizationId: orgId,
        limit: LIMIT,
      }),
    localCache: latestRunsCache,
    staleTime: 1000 * 5,
  });
