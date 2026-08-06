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

/**
 * Every file row of a run, with captions and annotations — the Files tab's
 * data source.
 *
 * A caller that only needs to know which log names hold which file TYPES wants
 * `runs.data.fileLogTypes` instead: this response is a row per file (up to
 * 10,000) and is a multi-MB fetch for an image-heavy run.
 */
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
