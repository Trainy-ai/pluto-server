import { queryClient, trpc, trpcClient } from "@/utils/trpc";
import { prefetchLocalQuery, useLocalQuery } from "@/lib/hooks/use-local-query";
import { LocalCache } from "@/lib/db/local-cache";
import type { inferOutput } from "@trpc/tanstack-react-query";

type GetRunData = inferOutput<typeof trpc.runs.get>;

const getRunCache = new LocalCache<GetRunData>("getRun", "getRun", 1000 * 100);

export const useGetRun = (orgId: string, projectName: string, runId: string) =>
  useLocalQuery<GetRunData>({
    queryKey: trpc.runs.get.queryKey({
      organizationId: orgId,
      projectName: projectName,
      runId: runId,
    }),
    queryFn: () =>
      trpcClient.runs.get.query({
        organizationId: orgId,
        projectName: projectName,
        runId: runId,
      }),
    localCache: getRunCache,
    staleTime: 1000 * 5,
  });

export const prefetchGetRun = (
  orgId: string,
  projectName: string,
  runId: string,
) =>
  prefetchLocalQuery(queryClient, {
    queryKey: trpc.runs.get.queryKey({
      organizationId: orgId,
      projectName: projectName,
      runId: runId,
    }),
    queryFn: () =>
      trpcClient.runs.get.query({
        organizationId: orgId,
        projectName: projectName,
        runId: runId,
      }),
    localCache: getRunCache,
    staleTime: 1000 * 5,
  });
