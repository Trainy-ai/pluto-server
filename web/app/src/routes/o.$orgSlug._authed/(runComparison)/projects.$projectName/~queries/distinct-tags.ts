import { trpc, trpcClient } from "@/utils/trpc";
import { useQuery } from "@tanstack/react-query";

/**
 * Hook to get all distinct tags across all runs in a project.
 * This is used to populate the tags filter dropdown with all available tags,
 * not just those from the currently fetched page of runs.
 */
export const useDistinctTags = (
  orgId: string,
  projectName: string,
) => {
  return useQuery<{ tags: string[] }>({
    placeholderData: (prev) => prev,
    queryKey: trpc.runs.distinctTags.queryKey({
      organizationId: orgId,
      projectName,
    }),
    queryFn: () =>
      trpcClient.runs.distinctTags.query({
        organizationId: orgId,
        projectName,
      }),
  });
};
