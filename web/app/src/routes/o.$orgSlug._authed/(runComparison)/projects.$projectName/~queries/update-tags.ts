import { trpc } from "@/utils/trpc";
import { useMutation, useQueryClient } from "@tanstack/react-query";

export const useUpdateTags = (orgId: string, projectName: string) => {
  const queryClient = useQueryClient();

  return useMutation(
    trpc.runs.updateTags.mutationOptions({
      onSuccess: () => {
        // Invalidate the runs list query to refetch with updated tags
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
