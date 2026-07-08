import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { trpc, trpcClient } from "@/utils/trpc";
import type { Run } from "../~queries/list-runs";

const DROPDOWN_RESULT_LIMIT = 30;

interface UseSearchOtherMatchesParams {
  organizationId: string;
  projectName: string;
  /** Trimmed, debounced search query — empty string disables the hook. */
  query: string;
  /**
   * IDs of runs currently visible in the table (filter + selected sticky).
   *
   * MUST be referentially stable (`useMemo`-derived) — passing `new Set(...)`
   * inline on every render will bust the partition memo on every render.
   */
  inViewRunIds: Set<string>;
  filterActive: boolean;
  displayOnlySelectedActive: boolean;
  /** Pin-selected-to-top also constrains the visual top of the table
   *  to the selected runs, so search hits that fall in the unpinned
   *  region (or past the page slice) feel "outside view" the same way
   *  filter / display-only-selected hits do. Enabling this gate keeps
   *  the dropdown's trigger conditions consistent with what the user
   *  perceives as a "constrained view". */
  pinSelectedToTopActive: boolean;
  /**
   * Optional caller-side gate. When `false`, the hook stops firing the
   * underlying `useQuery` (and TanStack cancels any in-flight request).
   * Useful for keeping the hook idle while the dropdown is dismissed —
   * primarily prevents `refetchOnWindowFocus` from re-firing during a
   * dismissal cycle. Defaults to `true`.
   */
  enabled?: boolean;
}

interface UseSearchOtherMatchesResult {
  outOfView: Run[];
  inView: Run[];
  isLoading: boolean;
  /** Number of runs returned by this query (capped at DROPDOWN_RESULT_LIMIT).
   *  NOT the true total of matching runs in the project — the server does
   *  not return that. Use `hasMore` to detect truncation. */
  resultCount: number;
  /** True when the server response indicates more matches exist beyond
   *  `DROPDOWN_RESULT_LIMIT`. Derived from the response's `nextCursor`
   *  (or `sortCursor` / `nextOffset` — runs.list uses different cursor
   *  fields depending on pagination mode). */
  hasMore: boolean;
}

/**
 * Search across all runs in the project, ignoring the active filter and
 * "Display only selected". Used by the "Other matches" dropdown so users
 * can add runs from outside the current view to their selection.
 *
 * Hard-gated: fires only when the search is non-empty AND something is
 * constraining the table view (filter active OR display-only-selected on).
 */
export function useSearchOtherMatches({
  organizationId,
  projectName,
  query,
  inViewRunIds,
  filterActive,
  displayOnlySelectedActive,
  pinSelectedToTopActive,
  enabled: enabledProp = true,
}: UseSearchOtherMatchesParams): UseSearchOtherMatchesResult {
  const trimmedQuery = query.trim();
  const enabled =
    enabledProp &&
    trimmedQuery.length > 0 &&
    (filterActive || displayOnlySelectedActive || pinSelectedToTopActive);

  const queryArgs = {
    organizationId,
    projectName,
    limit: DROPDOWN_RESULT_LIMIT,
    search: trimmedQuery,
  };

  const { data, isLoading } = useQuery({
    queryKey: [
      ...trpc.runs.list.queryKey(queryArgs),
      "search-other-matches",
    ],
    queryFn: () => trpcClient.runs.list.query(queryArgs),
    enabled,
    staleTime: 30_000,
  });

  return useMemo(() => {
    const runs: Run[] = data?.runs ?? [];
    const outOfView: Run[] = [];
    const inView: Run[] = [];
    for (const run of runs) {
      if (inViewRunIds.has(run.id)) {
        inView.push(run);
      } else {
        outOfView.push(run);
      }
    }
    const hasMore =
      (data as any)?.nextCursor != null ||
      (data as any)?.sortCursor != null ||
      (data as any)?.nextOffset != null;
    return { outOfView, inView, isLoading, resultCount: runs.length, hasMore };
  }, [data, inViewRunIds, isLoading]);
}
