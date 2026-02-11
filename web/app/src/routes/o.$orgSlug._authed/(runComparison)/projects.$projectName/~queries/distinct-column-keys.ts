import { trpc, trpcClient } from "@/utils/trpc";
import { useQuery } from "@tanstack/react-query";

export interface ColumnKeyWithType {
  key: string;
  type: "text" | "number" | "date";
}

interface DistinctColumnKeysResult {
  configKeys: ColumnKeyWithType[];
  systemMetadataKeys: ColumnKeyWithType[];
}

/**
 * Hook to get all distinct flattened keys from config and systemMetadata
 * across recent runs in a project. Used to populate the column picker and filter builder.
 */
export const useDistinctColumnKeys = (
  orgId: string,
  projectName: string,
) => {
  return useQuery<DistinctColumnKeysResult>({
    queryKey: trpc.runs.distinctColumnKeys.queryKey({
      organizationId: orgId,
      projectName,
    }),
    queryFn: () =>
      trpcClient.runs.distinctColumnKeys.query({
        organizationId: orgId,
        projectName,
      }),
    staleTime: 5 * 60 * 1000, // 5 min cache
  });
};

/**
 * Hook to search for distinct config/systemMetadata keys across ALL runs
 * in a project. Triggered when the user types a search query in the filter
 * dropdown. Returns at most 100 matching keys per source.
 *
 * Only fires when search is non-empty; returns undefined otherwise.
 */
export const useSearchColumnKeys = (
  orgId: string,
  projectName: string,
  search: string,
) => {
  return useQuery<DistinctColumnKeysResult>({
    queryKey: trpc.runs.searchColumnKeys.queryKey({
      organizationId: orgId,
      projectName,
      search,
    }),
    queryFn: () =>
      trpcClient.runs.searchColumnKeys.query({
        organizationId: orgId,
        projectName,
        search,
      }),
    enabled: search.length > 0,
    staleTime: 60 * 1000, // 1 min cache for searches
    placeholderData: (prev) => prev, // keep previous results while loading
  });
};
