import { useQuery } from "@tanstack/react-query";
import { trpc } from "@/utils/trpc";

/**
 * The run's distinct `(logName, fileType)` pairs — the metrics view's file
 * probe.
 *
 * Plain `useQuery`, not `useLocalQuery`: the response is a handful of short
 * strings, so an IndexedDB round trip (and the write on every refetch) costs
 * more than the request it would save. `runs.data.fileTree` is the hook to
 * reach for when the actual FILES are needed — this one deliberately cannot
 * answer that.
 *
 * `enabled: false` skips the request entirely, for callers that can tell up
 * front the answer cannot change anything.
 */
export const useGetFileLogTypes = (
  orgId: string,
  projectName: string,
  runId: string,
  options?: { enabled?: boolean },
) =>
  useQuery(
    trpc.runs.data.fileLogTypes.queryOptions(
      { organizationId: orgId, projectName, runId },
      {
        staleTime: 1000 * 30,
        ...(options?.enabled === undefined ? {} : { enabled: options.enabled }),
      },
    ),
  );
