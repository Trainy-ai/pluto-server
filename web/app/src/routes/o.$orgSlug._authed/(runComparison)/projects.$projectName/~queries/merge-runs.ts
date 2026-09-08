import { trpc } from "@/utils/trpc";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { invalidateRunsQueries } from "@/lib/hooks/use-optimistic-list-update";

// No optimistic update: unlike delete, merge doesn't remove rows from the
// list, so a plain invalidate on settle is correct and simpler.

export const useMergeRuns = () => {
  const queryClient = useQueryClient();

  return useMutation(
    trpc.runs.merge.mutationOptions({
      onError: (err) => {
        toast.error(err.message || "Failed to merge runs");
      },
      onSuccess: (data) => {
        if (data.links.length === 0) {
          toast.info("Selected runs are already merged");
        } else {
          toast.success(
            `Merged ${data.links.length + 1} runs into one lineage`
          );
        }
      },
      onSettled: () => {
        invalidateRunsQueries(queryClient);
      },
    })
  );
};

export const useUnmergeRun = () => {
  const queryClient = useQueryClient();

  return useMutation(
    trpc.runs.unmerge.mutationOptions({
      onError: (err) => {
        toast.error(err.message || "Failed to unlink run");
      },
      onSuccess: () => {
        toast.success("Run unlinked");
      },
      onSettled: () => {
        invalidateRunsQueries(queryClient);
      },
    })
  );
};
