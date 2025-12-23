import { queryClient, trpc, trpcClient } from "@/utils/trpc";
import {
  ensureLocalQuery,
  prefetchLocalQuery,
  useLocalQuery,
} from "@/lib/hooks/use-local-query";
import { LocalCache } from "@/lib/db/local-cache";
import type { inferOutput } from "@trpc/tanstack-react-query";

type GetGraphData = inferOutput<typeof trpc.runs.data.graph>;

const getGraphCache = new LocalCache<GetGraphData>(
  "getGraph",
  "getGraph",
  1000 * 10,
);

export const ensureGetGraph = (
  orgId: string,
  projectName: string,
  runId: string,
  logName: string,
) => {
  const data = ensureLocalQuery(queryClient, {
    queryKey: trpc.runs.data.graph.queryKey({
      organizationId: orgId,
      projectName: projectName,
      runId: runId,
      logName: logName,
    }),
    queryFn: () =>
      trpcClient.runs.data.graph.query({
        organizationId: orgId,
        projectName: projectName,
        runId: runId,
        logName: logName,
      }),
    localCache: getGraphCache,
    staleTime: 1000 * 5,
  });

  return data;
};

export const useGetGraph = (
  orgId: string,
  projectName: string,
  runId: string,
  logName: string,
) =>
  useLocalQuery<GetGraphData>({
    queryKey: trpc.runs.data.graph.queryKey({
      organizationId: orgId,
      projectName: projectName,
      runId: runId,
      logName: logName,
    }),
    queryFn: () =>
      trpcClient.runs.data.graph.query({
        organizationId: orgId,
        projectName: projectName,
        runId: runId,
        logName: logName,
      }),
    localCache: getGraphCache,
    staleTime: 1000 * 5,
  });

export const prefetchGetGraph = (
  orgId: string,
  projectName: string,
  runId: string,
  logName: string,
) =>
  prefetchLocalQuery(queryClient, {
    queryKey: trpc.runs.data.graph.queryKey({
      organizationId: orgId,
      projectName: projectName,
      runId: runId,
      logName: logName,
    }),
    queryFn: () =>
      trpcClient.runs.data.graph.query({
        organizationId: orgId,
        projectName: projectName,
        runId: runId,
        logName: logName,
      }),
    localCache: getGraphCache,
    staleTime: 1000 * 5,
  });
