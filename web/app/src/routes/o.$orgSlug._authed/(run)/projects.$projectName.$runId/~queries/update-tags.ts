import { trpc } from "@/utils/trpc";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { inferOutput } from "@trpc/tanstack-react-query";
import {
  cancelRunsQueries,
  patchRunsListCache,
  rollbackRunsListCache,
  invalidateRunsQueries,
} from "@/lib/hooks/use-optimistic-list-update";

type GetRunData = inferOutput<typeof trpc.runs.get>;

export const useUpdateTags = (orgId: string, projectName: string, runId: string) => {
  const queryClient = useQueryClient();

  const runGetQueryKey = trpc.runs.get.queryKey({
    organizationId: orgId,
    projectName: projectName,
    runId: runId,
  });

  return useMutation(
    trpc.runs.updateTags.mutationOptions({
      onMutate: async (newData) => {
        await cancelRunsQueries(queryClient);

        // Snapshot and patch the single-run query
        const previousRun = queryClient.getQueryData<GetRunData>(runGetQueryKey);
        if (previousRun) {
          queryClient.setQueryData<GetRunData>(runGetQueryKey, {
            ...previousRun,
            tags: newData.tags,
          });
        }

        // Snapshot and patch all runs list infinite queries
        const listSnapshots = patchRunsListCache(queryClient, newData.runId, (run) => ({
          ...run,
          tags: newData.tags,
        }));

        return { previousRun, listSnapshots };
      },
      onError: (_err, newData, context) => {
        // Roll back the single-run query
        if (context?.previousRun) {
          queryClient.setQueryData(runGetQueryKey, context.previousRun);
        }
        rollbackRunsListCache(queryClient, context?.listSnapshots ?? []);
        toast.error(`Failed to update tags for run ${runId}`);
      },
      onSettled: () => {
        queryClient.invalidateQueries({ queryKey: runGetQueryKey });
        invalidateRunsQueries(queryClient);
      },
    })
  );
};
