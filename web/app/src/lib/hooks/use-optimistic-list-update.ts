import type { QueryClient } from "@tanstack/react-query";
import type { InfiniteData } from "@tanstack/react-query";
import type { ListRunResponse, Run } from "@/routes/o.$orgSlug._authed/(runComparison)/projects.$projectName/~queries/list-runs";

type ListQuerySnapshot = [readonly unknown[], InfiniteData<ListRunResponse> | undefined];

/**
 * Cancel all in-flight runs queries to prevent them from overwriting
 * an optimistic cache update.
 */
export async function cancelRunsQueries(queryClient: QueryClient) {
  await queryClient.cancelQueries({
    predicate: (q) => (q.queryKey[0] as string[])?.[0] === "runs",
  });
}

/**
 * Snapshot all cached `runs.list` infinite queries, then apply `patchRun`
 * to every run whose `id` matches `runId`.
 *
 * Returns the snapshots so the caller can roll back on error.
 */
export function patchRunsListCache(
  queryClient: QueryClient,
  runId: string,
  patchRun: (run: Run) => Run,
): ListQuerySnapshot[] {
  const snapshots: ListQuerySnapshot[] = [];

  queryClient
    .getQueriesData<InfiniteData<ListRunResponse>>({
      predicate: (q) => {
        const key = q.queryKey[0] as string[];
        return key?.[0] === "runs" && key?.[1] === "list";
      },
    })
    .forEach(([queryKey, data]) => {
      snapshots.push([queryKey, data]);
      // A cached but never-enabled infinite query can be a truthy `{}`
      // rather than `undefined` (React Query's `placeholderData:
      // keepPreviousData` on an initially-disabled query — see
      // useListRuns). Guarding on `!data` alone let those partial
      // shapes through and `data.pages.map(...)` two lines below
      // threw `Cannot read properties of undefined (reading 'map')`
      // inside the mutation's onMutate, which surfaced as a
      // misleading "Failed to update notes" toast even though the
      // server hadn't been called yet. Skip anything that isn't a
      // fully-formed infinite-query snapshot.
      if (!data || !Array.isArray(data.pages)) return;
      queryClient.setQueryData<InfiniteData<ListRunResponse>>(queryKey, {
        ...data,
        pages: data.pages.map((page) => ({
          ...page,
          runs: page.runs.map((run: Run) =>
            run.id === runId ? patchRun(run) : run,
          ),
        })),
      });
    });

  return snapshots;
}

/**
 * Snapshot all cached `runs.list` infinite queries, then remove every run
 * whose `id` is in `runIds`.
 *
 * Returns the snapshots so the caller can roll back on error.
 */
export function removeRunsFromListCache(
  queryClient: QueryClient,
  runIds: string[],
): ListQuerySnapshot[] {
  const toRemove = new Set(runIds);
  const snapshots: ListQuerySnapshot[] = [];

  queryClient
    .getQueriesData<InfiniteData<ListRunResponse>>({
      predicate: (q) => {
        const key = q.queryKey[0] as string[];
        return key?.[0] === "runs" && key?.[1] === "list";
      },
    })
    .forEach(([queryKey, data]) => {
      snapshots.push([queryKey, data]);
      // See `patchRunsListCache` above for why we guard `data.pages`
      // as well as `data` — partial infinite-query snapshots leak
      // through the `!data` check under keepPreviousData.
      if (!data || !Array.isArray(data.pages)) return;
      queryClient.setQueryData<InfiniteData<ListRunResponse>>(queryKey, {
        ...data,
        pages: data.pages.map((page) => ({
          ...page,
          runs: page.runs.filter((run: Run) => !toRemove.has(run.id)),
        })),
      });
    });

  return snapshots;
}

/**
 * Restore all cached `runs.list` infinite queries from snapshots.
 */
export function rollbackRunsListCache(
  queryClient: QueryClient,
  snapshots: ListQuerySnapshot[],
) {
  snapshots.forEach(([queryKey, data]) => {
    queryClient.setQueryData(queryKey, data);
  });
}

/**
 * Invalidate all queries whose top-level key starts with `"runs"`.
 */
export function invalidateRunsQueries(queryClient: QueryClient) {
  queryClient.invalidateQueries({
    predicate: (q) => (q.queryKey[0] as string[])?.[0] === "runs",
  });
}
