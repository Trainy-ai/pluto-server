import { trpc } from "@/utils/trpc";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { errorReason } from "@/lib/error-message";
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
      onError: (err, newData, context) => {
        rollbackRunsListCache(queryClient, context?.snapshots ?? []);
        // Surface the backend's reason (e.g. "A run can have at most one
        // group:* tag.") behind a "Failed to update tags:" prefix so it's clear
        // the save failed; fall back to the generic message otherwise.
        const reason = errorReason(err);
        toast.error(
          reason
            ? `Failed to update tags: ${reason}`
            : `Failed to update tags for run ${newData.runId}`,
        );
      },
      onSettled: () => {
        invalidateRunsQueries(queryClient);
      },
    })
  );
};
