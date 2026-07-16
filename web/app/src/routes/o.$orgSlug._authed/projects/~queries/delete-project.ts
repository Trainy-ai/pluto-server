import { trpc, queryClient } from "@/utils/trpc";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";

export const useDeleteProject = (organizationId: string) => {
  return useMutation(
    trpc.projects.delete.mutationOptions({
      onError: (err) => {
        toast.error(err.message || "Failed to delete project");
      },
      onSuccess: (data, variables) => {
        const n = data.deletedRunCount;
        toast.success(
          `Deleted project "${variables.projectName}" and ${n} ${n === 1 ? "run" : "runs"}`,
        );
      },
      onSettled: () => {
        // The projects table reads through useLocalQuery, so invalidate with
        // refetchType "all" (same as the page's refresh button) to force a
        // refetch that rewrites the local cache.
        void queryClient.invalidateQueries({
          queryKey: trpc.projects.list.queryKey(),
          refetchType: "all",
        });
        void queryClient.invalidateQueries({
          queryKey: trpc.projects.count.queryKey({ organizationId }),
          refetchType: "all",
        });
      },
    }),
  );
};
