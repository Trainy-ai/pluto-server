import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { InvalidateQueryFilters } from "@tanstack/react-query";

interface UseRefreshOptions {
  queries: InvalidateQueryFilters[];
  onRefresh?: () => void | Promise<void>;
}

export function useRefresh({ queries, onRefresh }: UseRefreshOptions) {
  const queryClient = useQueryClient();
  const [lastRefreshed, setLastRefreshed] = useState<Date | undefined>(
    undefined,
  );
  const [isRefreshing, setIsRefreshing] = useState(false);

  const refresh = async () => {
    try {
      setIsRefreshing(true);

      // Invalidate specified queries. The caller owns `refetchType` per
      // entry — we don't force a value here, so callers can mix
      // "active" (only refetch what's currently visible) and "all"
      // (refetch every cached entry including inactive ones) as needed.
      // If omitted, React Query's default is "active".
      await Promise.all(
        queries.map((query) =>
          queryClient.invalidateQueries(query),
        ),
      );

      // Call the optional onRefresh callback if provided
      if (onRefresh) {
        await onRefresh();
      }

      setLastRefreshed(new Date());
    } finally {
      setIsRefreshing(false);
    }
  };

  return {
    refresh,
    lastRefreshed,
    isRefreshing,
  };
}
