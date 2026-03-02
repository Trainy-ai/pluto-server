import { queryClient, trpc, trpcClient } from "@/utils/trpc";
import { prefetchLocalQuery, useLocalQuery } from "@/lib/hooks/use-local-query";
import { LocalCache } from "@/lib/db/local-cache";
import type { inferOutput } from "@trpc/tanstack-react-query";

type GetMetricValuesData = inferOutput<typeof trpc.runs.data.metricValues>;

const getMetricValuesCache = new LocalCache<GetMetricValuesData>(
  "getMetricValues",
  "getMetricValues",
  1000 * 30,
);

export const useGetMetricValues = (
  orgId: string,
  projectName: string,
  runId: string,
) =>
  useLocalQuery<GetMetricValuesData>({
    queryKey: trpc.runs.data.metricValues.queryKey({
      organizationId: orgId,
      projectName: projectName,
      runId: runId,
    }),
    queryFn: () =>
      trpcClient.runs.data.metricValues.query({
        organizationId: orgId,
        projectName: projectName,
        runId: runId,
      }),
    localCache: getMetricValuesCache,
    staleTime: 1000 * 10,
  });

export const prefetchGetMetricValues = (
  orgId: string,
  projectName: string,
  runId: string,
) =>
  prefetchLocalQuery(queryClient, {
    queryKey: trpc.runs.data.metricValues.queryKey({
      organizationId: orgId,
      projectName: projectName,
      runId: runId,
    }),
    queryFn: () =>
      trpcClient.runs.data.metricValues.query({
        organizationId: orgId,
        projectName: projectName,
        runId: runId,
      }),
    localCache: getMetricValuesCache,
    staleTime: 1000 * 10,
  });
