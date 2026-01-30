import { trpc, trpcClient } from "@/utils/trpc";
import { useQuery } from "@tanstack/react-query";
import type { inferOutput } from "@trpc/tanstack-react-query";

export type LogsByRunId = inferOutput<typeof trpc.runs.getLogsByRunIds>;

export const useSelectedRunLogs = (
  selectedRunIds: string[],
  projectName: string,
  organizationId: string,
) => {
  // Sort IDs for stable query key
  const sortedIds = [...selectedRunIds].sort();

  return useQuery({
    queryKey: ["runLogs", organizationId, projectName, sortedIds],
    queryFn: async () => {
      if (sortedIds.length === 0) return {};
      return trpcClient.runs.getLogsByRunIds.query({
        runIds: sortedIds,
        projectName,
        organizationId,
      });
    },
    enabled: sortedIds.length > 0,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
};
