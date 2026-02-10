import { trpc } from "@/utils/trpc";
import { useMutation, useQueryClient } from "@tanstack/react-query";

export const useUpdateNotes = (orgId: string, projectName: string) => {
  const queryClient = useQueryClient();

  return useMutation(
    trpc.runs.updateNotes.mutationOptions({
      onSuccess: () => {
        // Invalidate all runs queries to refetch with updated notes
        queryClient.invalidateQueries({
          queryKey: [["runs"]],
        });
      },
    })
  );
};
