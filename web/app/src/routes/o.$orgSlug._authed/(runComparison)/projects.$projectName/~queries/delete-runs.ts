import { trpc } from "@/utils/trpc";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  cancelRunsQueries,
  removeRunsFromListCache,
  rollbackRunsListCache,
  invalidateRunsQueries,
} from "@/lib/hooks/use-optimistic-list-update";

export const useDeleteRuns = (orgId: string, projectName: string) => {
  const queryClient = useQueryClient();

  return useMutation(
    trpc.runs.delete.mutationOptions({
      onMutate: async (newData) => {
        await cancelRunsQueries(queryClient);
        const snapshots = removeRunsFromListCache(queryClient, newData.runIds);
        return { snapshots };
      },
      onError: (err, _newData, context) => {
        rollbackRunsListCache(queryClient, context?.snapshots ?? []);
        toast.error(err.message || "Failed to delete runs");
      },
      onSuccess: (data) => {
        const n = data.deletedCount;
        toast.success(`Deleted ${n} ${n === 1 ? "run" : "runs"}`);
      },
      onSettled: () => {
        invalidateRunsQueries(queryClient);
      },
    })
  );
};
