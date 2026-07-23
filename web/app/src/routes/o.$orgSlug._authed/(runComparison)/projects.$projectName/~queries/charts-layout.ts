import { trpc } from "@/utils/trpc";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { inferOutput } from "@trpc/tanstack-react-query";

export type GetChartsLayoutResponse = inferOutput<typeof trpc.chartsLayout.get>;

/**
 * Fetch the shared layout overlay for a project's default Charts view.
 * The server always returns a well-formed (possibly empty) config.
 */
export const useChartsLayout = (organizationId: string, projectName: string) => {
  return useQuery(
    trpc.chartsLayout.get.queryOptions(
      { organizationId, projectName },
      { placeholderData: (prev) => prev },
    ),
  );
};

/**
 * Save the shared layout overlay. On success the fetched query is primed with
 * the server response so the view reflects the new arrangement immediately.
 */
export const useUpsertChartsLayout = (
  organizationId: string,
  projectName: string,
) => {
  const queryClient = useQueryClient();

  return useMutation({
    ...trpc.chartsLayout.upsert.mutationOptions(),
    onSuccess: (data) => {
      queryClient.setQueryData(
        trpc.chartsLayout.get.queryOptions({ organizationId, projectName })
          .queryKey,
        data,
      );
    },
  });
};
