import { queryClient, trpc, trpcClient } from "@/utils/trpc";
import { prefetchLocalQuery, useLocalQuery } from "@/lib/hooks/use-local-query";
import { LocalCache } from "@/lib/db/local-cache";
import type { inferOutput } from "@trpc/tanstack-react-query";

type GetImagesData = inferOutput<typeof trpc.runs.data.files>;

const getImagesCache = new LocalCache<GetImagesData>(
  "getImages",
  "getImages",
  1000 * 10,
);

export const useGetImages = (
  orgId: string,
  projectName: string,
  runId: string,
  logName: string,
) =>
  useLocalQuery<GetImagesData>({
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
    localCache: getImagesCache,
    staleTime: 1000 * 5,
  });

export const prefetchGetImages = (
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
    localCache: getImagesCache,
    staleTime: 1000 * 5,
  });
