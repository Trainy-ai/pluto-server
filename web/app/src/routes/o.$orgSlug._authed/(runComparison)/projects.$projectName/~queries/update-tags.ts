import { trpc } from "@/utils/trpc";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  cancelRunsQueries,
  patchRunsListCache,
  rollbackRunsListCache,
  invalidateRunsQueries,
} from "@/lib/hooks/use-optimistic-list-update";

export const useUpdateTags = (orgId: string, projectName: string) => {
  const queryClient = useQueryClient();

  return useMutation(
    trpc.runs.updateTags.mutationOptions({
      onMutate: async (newData) => {
        await cancelRunsQueries(queryClient);
        const snapshots = patchRunsListCache(queryClient, newData.runId, (run) => ({
          ...run,
          tags: newData.tags,
        }));
        return { snapshots };
      },
      onError: (_err, newData, context) => {
        rollbackRunsListCache(queryClient, context?.snapshots ?? []);
        toast.error(`Failed to update tags for run ${newData.runId}`);
      },
      onSettled: () => {
        invalidateRunsQueries(queryClient);
      },
    })
  );
};
