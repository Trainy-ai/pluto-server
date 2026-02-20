import { queryClient, trpc, trpcClient } from "@/utils/trpc";
import { prefetchLocalQuery, useLocalQuery } from "@/lib/hooks/use-local-query";
import { LocalCache } from "@/lib/db/local-cache";
import type { inferOutput } from "@trpc/tanstack-react-query";

type GetFileTreeData = inferOutput<typeof trpc.runs.data.fileTree>;

const getFileTreeCache = new LocalCache<GetFileTreeData>(
  "getFileTree",
  "getFileTree",
  1000 * 30,
);

export const useGetFileTree = (
  orgId: string,
  projectName: string,
  runId: string,
) =>
  useLocalQuery<GetFileTreeData>({
    queryKey: trpc.runs.data.fileTree.queryKey({
      organizationId: orgId,
      projectName: projectName,
      runId: runId,
    }),
    queryFn: () =>
      trpcClient.runs.data.fileTree.query({
        organizationId: orgId,
        projectName: projectName,
        runId: runId,
      }),
    localCache: getFileTreeCache,
    staleTime: 1000 * 10,
  });

export const prefetchGetFileTree = (
  orgId: string,
  projectName: string,
  runId: string,
) =>
  prefetchLocalQuery(queryClient, {
    queryKey: trpc.runs.data.fileTree.queryKey({
      organizationId: orgId,
      projectName: projectName,
      runId: runId,
    }),
    queryFn: () =>
      trpcClient.runs.data.fileTree.query({
        organizationId: orgId,
        projectName: projectName,
        runId: runId,
      }),
    localCache: getFileTreeCache,
    staleTime: 1000 * 10,
  });
