import { trpc } from "@/utils/trpc";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  cancelRunsQueries,
  patchRunsListCache,
  rollbackRunsListCache,
  invalidateRunsQueries,
} from "@/lib/hooks/use-optimistic-list-update";

export const useUpdateNotes = (orgId: string, projectName: string) => {
  const queryClient = useQueryClient();

  return useMutation(
    trpc.runs.updateNotes.mutationOptions({
      onMutate: async (newData) => {
        await cancelRunsQueries(queryClient);
        const snapshots = patchRunsListCache(queryClient, newData.runId, (run) => ({
          ...run,
          notes: newData.notes ?? null,
        }));
        return { snapshots };
      },
      onError: (_err, newData, context) => {
        rollbackRunsListCache(queryClient, context?.snapshots ?? []);
        toast.error(`Failed to update notes for run ${newData.runId}`);
      },
      onSettled: () => {
        invalidateRunsQueries(queryClient);
      },
    })
  );
};
