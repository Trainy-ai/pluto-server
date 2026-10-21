import { useQuery } from "@tanstack/react-query";
import { trpc } from "@/utils/trpc";
import { buildListRunsFilterInput, type ListRunsFilters, type Run } from "../~queries/list-runs";

/** Mirrors `parseDisplayId` in web/server/lib/run-prefix.ts. */
const DISPLAY_ID_PATTERN = /^[A-Za-z0-9]+-\d+$/;

export function isDisplayIdShaped(search: string): boolean {
  return DISPLAY_ID_PATTERN.test(search.trim());
}

interface UseExactIdMatchParams {
  organizationId: string;
  projectName: string;
  /** Debounced search text. */
  search: string;
  /** The main runs table's filters, so the pinned row obeys them too. */
  filters: Omit<ListRunsFilters, "search">;
  enabled: boolean;
}

/**
 * The run whose display ID equals the search, or null. The runs table pins
 * it above the substring matches so an old run is not buried under runs
 * whose names contain its ID.
 */
export function useExactIdMatch({
  organizationId,
  projectName,
  search,
  filters,
  enabled,
}: UseExactIdMatchParams): Run | null {
  const trimmed = search.trim();
  const isActive = enabled && isDisplayIdShaped(trimmed);

  const { data } = useQuery(
    trpc.runs.list.queryOptions(
      {
        organizationId,
        projectName,
        limit: 1,
        searchMode: "exactDisplayId",
        ...buildListRunsFilterInput({ ...filters, search: trimmed }),
      },
      { enabled: isActive, staleTime: 30_000 },
    ),
  );

  return isActive ? (data?.runs[0] ?? null) : null;
}
