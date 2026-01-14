import { queryClient, trpc, trpcClient } from "@/utils/trpc";
import { prefetchLocalQuery, useLocalQuery } from "@/lib/hooks/use-local-query";
import { LocalCache } from "@/lib/db/local-cache";
import type { inferOutput } from "@trpc/tanstack-react-query";

type GetTextFilesData = inferOutput<typeof trpc.runs.data.files>;

const getTextFilesCache = new LocalCache<GetTextFilesData>(
  "getTextFiles",
  "getTextFiles",
  1000 * 10,
);

export const useGetTextFiles = (
  orgId: string,
  projectName: string,
  runId: string,
  logName: string,
) =>
  useLocalQuery<GetTextFilesData>({
    queryKey: trpc.runs.data.files.queryKey({
      organizationId: orgId,
      projectName: projectName,
      runId: runId,
      logName: logName,
    }),
    queryFn: () =>
      trpcClient.runs.data.files.query({
        organizationId: orgId,
        projectName: projectName,
        runId: runId,
        logName: logName,
      }),
    localCache: getTextFilesCache,
    staleTime: 1000 * 5,
  });

export const prefetchGetTextFiles = (
  orgId: string,
  projectName: string,
  runId: string,
  logName: string,
) =>
  prefetchLocalQuery(queryClient, {
    queryKey: trpc.runs.data.files.queryKey({
      organizationId: orgId,
      projectName: projectName,
      runId: runId,
      logName: logName,
    }),
    queryFn: () =>
      trpcClient.runs.data.files.query({
        organizationId: orgId,
        projectName: projectName,
        runId: runId,
        logName: logName,
      }),
    localCache: getTextFilesCache,
    staleTime: 1000 * 5,
  });
