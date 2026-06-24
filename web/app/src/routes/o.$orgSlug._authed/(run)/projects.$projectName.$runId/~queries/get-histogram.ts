import { queryClient, trpc, trpcClient } from "@/utils/trpc";
import { prefetchLocalQuery, useLocalQuery } from "@/lib/hooks/use-local-query";
import { LocalCache } from "@/lib/db/local-cache";
import type { inferOutput } from "@trpc/tanstack-react-query";

type GetHistogramData = inferOutput<typeof trpc.runs.data.histogram>;

const getHistogramCache = new LocalCache<GetHistogramData>(
  "getHistogram-v2",
  "getHistogram",
  1000 * 10,
);

export const useGetHistogram = (
  orgId: string,
  projectName: string,
  runId: string,
  logName: string,
  stepCap?: number,
) =>
  useLocalQuery<GetHistogramData>({
    queryKey: trpc.runs.data.histogram.queryKey({
      organizationId: orgId,
      projectName: projectName,
      runId: runId,
      logName: logName,
      stepCap,
    }),
    queryFn: () =>
      trpcClient.runs.data.histogram.query({
        organizationId: orgId,
        projectName: projectName,
        runId: runId,
        logName: logName,
        stepCap,
      }),
    localCache: getHistogramCache,
    staleTime: 1000 * 5,
  });

export const prefetchGetHistogram = (
  orgId: string,
  projectName: string,
  runId: string,
  logName: string,
  stepCap?: number,
) =>
  prefetchLocalQuery(queryClient, {
    queryKey: trpc.runs.data.histogram.queryKey({
      organizationId: orgId,
      projectName: projectName,
      runId: runId,
      logName: logName,
      stepCap,
    }),
    queryFn: () =>
      trpcClient.runs.data.histogram.query({
        organizationId: orgId,
        projectName: projectName,
        runId: runId,
        logName: logName,
        stepCap,
      }),
    localCache: getHistogramCache,
    staleTime: 1000 * 5,
  });
