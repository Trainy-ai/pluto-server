import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { trpc } from "@/utils/trpc";

/** Mirrors the backend MAX_LIMIT and the dropdown render cap. */
export const TAG_SEARCH_LIMIT = 500;

const DEBOUNCE_MS = 200;

/** Stable empty array so consumers' memo deps don't churn when idle. */
const EMPTY_RESULTS: string[] = [];

/**
 * Server-side tag search across every run in a project.
 *
 * Tag dropdowns show the tags from the runs already loaded in the table by
 * default; this hook is what lets the user reach tags beyond that set. It
 * only hits the backend once `search` is non-empty (debounced), so an idle
 * dropdown costs nothing. Results are capped at {@link TAG_SEARCH_LIMIT}.
 */
export function useTagSearch(
  organizationId: string | undefined,
  projectName: string | undefined,
  search: string,
) {
  const [debounced, setDebounced] = useState(search.trim());

  useEffect(() => {
    const handle = setTimeout(() => setDebounced(search.trim()), DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [search]);

  const trimmed = search.trim();
  const enabled = !!organizationId && !!projectName && debounced.length > 0;
  // True between the caller's input change and the debounce settling — used
  // by consumers to keep showing a "searching" state instead of flashing an
  // empty/"no matches" view during the debounce window.
  const isPending =
    !!organizationId && !!projectName && trimmed.length > 0 && trimmed !== debounced;

  const query = useQuery(
    trpc.runs.distinctTags.queryOptions(
      {
        organizationId: organizationId ?? "",
        projectName: projectName ?? "",
        search: debounced,
        limit: TAG_SEARCH_LIMIT,
      },
      {
        enabled,
        staleTime: 30_000,
        placeholderData: (prev) => prev,
      },
    ),
  );

  return {
    /** Tags matching the (debounced) query; empty when no active search. */
    results: enabled ? (query.data?.tags ?? EMPTY_RESULTS) : EMPTY_RESULTS,
    /** True while a search request is in flight OR the debounce hasn't fired yet. */
    isSearching: isPending || (enabled && query.isFetching),
    /** Whether a (debounced) search is currently active. */
    isActive: enabled,
  };
}
