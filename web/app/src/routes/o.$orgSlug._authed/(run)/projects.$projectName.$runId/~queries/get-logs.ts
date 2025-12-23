import { queryClient, trpc, trpcClient } from "@/utils/trpc";
import { prefetchLocalQuery, useLocalQuery } from "@/lib/hooks/use-local-query";
import { LocalCache } from "@/lib/db/local-cache";
import type { inferOutput } from "@trpc/tanstack-react-query";

type GetLogsData = inferOutput<typeof trpc.runs.data.logs>;

const getLogsCache = new LocalCache<GetLogsData>(
  "getLogs",
  "getLogs",
  1000 * 10,
);

export const useGetLogs = (orgId: string, projectName: string, runId: string) =>
  useLocalQuery<GetLogsData>({
    queryKey: trpc.runs.data.logs.queryKey({
      organizationId: orgId,
      projectName: projectName,
      runId: runId,
    }),
    queryFn: () =>
      trpcClient.runs.data.logs.query({
        organizationId: orgId,
        projectName: projectName,
        runId: runId,
      }),
    localCache: getLogsCache,
    staleTime: 1000 * 5,
  });

export const prefetchGetLogs = (
  orgId: string,
  projectName: string,
  runId: string,
) =>
  prefetchLocalQuery(queryClient, {
    queryKey: trpc.runs.data.logs.queryKey({
      organizationId: orgId,
      projectName: projectName,
      runId: runId,
    }),
    queryFn: () =>
      trpcClient.runs.data.logs.query({
        organizationId: orgId,
        projectName: projectName,
        runId: runId,
      }),
    localCache: getLogsCache,
    staleTime: 1000 * 5,
  });
