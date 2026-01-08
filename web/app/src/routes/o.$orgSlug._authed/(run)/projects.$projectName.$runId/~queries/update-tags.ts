import { trpc } from "@/utils/trpc";
import { useMutation, useQueryClient } from "@tanstack/react-query";

export const useUpdateTags = (orgId: string, projectName: string, runId: string) => {
  const queryClient = useQueryClient();

  return useMutation(
    trpc.runs.updateTags.mutationOptions({
      onSuccess: () => {
        // Invalidate the run query to refetch with updated tags
        queryClient.invalidateQueries({
          queryKey: trpc.runs.get.queryKey({
            organizationId: orgId,
            projectName: projectName,
            runId: runId,
          }),
        });
        // Also invalidate the runs list in case they navigate back
        queryClient.invalidateQueries({
          predicate: (query) => {
            const firstEntry = query.queryKey[0] as string | string[];
            return firstEntry?.[0] === "runs";
          },
        });
      },
    })
  );
};
