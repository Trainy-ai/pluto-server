import { trpc } from "@/utils/trpc";
import { useQueries, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import {
  mergeEligiblePrefixes,
  type EligiblePrefixEntry,
} from "./eligible-prefixes-merge";

export type { EligiblePrefixEntry };

/**
 * Eligible {bars} prefixes for the Add-Widget Files dropdown.
 * Returns the union of:
 *   - one runs.data.eligiblePrefixes call per selected run (if any), AND
 *   - one project-wide call (runId omitted) so prefix entries surface
 *     even before the user selects any runs.
 * Both paths share the same prefix → max-suffix-count merge logic.
 * Surfaces deepest prefixes with >= 3 children.
 */
export function useEligiblePrefixesForRuns(
  orgId: string,
  projectName: string,
  runIds: string[],
  enabled: boolean = true,
) {
  // Per-run queries (when runs are selected — narrows results to "this prefix
  // is actually present in the user's chosen runs"). A user with hundreds
  // of runs but only 2 selected wants `{bars}` to reflect just those 2.
  const perRunQueries = useQueries({
    queries: runIds.map((runId) =>
      trpc.runs.data.eligiblePrefixes.queryOptions(
        { organizationId: orgId, projectName, runId },
        {
          // Guard `.length` on possibly-undefined params. Route params can be
          // briefly absent during navigation transitions; an unguarded
          // `runId.length` crashes the whole dashboard with
          // "Cannot read properties of undefined (reading 'length')".
          enabled: enabled && (runId?.length ?? 0) > 0,
          staleTime: 1000 * 30,
        },
      ),
    ),
  });

  // Project-wide fallback (runId omitted). Always runs — its results power
  // the dropdown when nothing is selected and also serve as a safety net
  // when the user-selected runs don't cover all eligible prefixes.
  const projectQuery = useQuery(
    trpc.runs.data.eligiblePrefixes.queryOptions(
      { organizationId: orgId, projectName },
      {
        enabled: enabled && (projectName?.length ?? 0) > 0,
        staleTime: 1000 * 30,
      },
    ),
  );

  const merged = useMemo<EligiblePrefixEntry[]>(
    () =>
      mergeEligiblePrefixes(
        perRunQueries.map((q) => (q.data ?? undefined) as EligiblePrefixEntry[] | undefined),
        projectQuery.data as EligiblePrefixEntry[] | undefined,
      ),
    [perRunQueries, projectQuery.data],
  );

  const isLoading =
    perRunQueries.some((q) => q.isLoading) || projectQuery.isLoading;
  return { data: merged, isLoading };
}

/**
 * Fetch distinct file-type log names (HISTOGRAM, IMAGE, VIDEO, AUDIO) in a project.
 * Returns the initial 500 log names for the file picker.
 */
export function useDistinctFileLogNames(orgId: string, projectName: string) {
  return useQuery(
    trpc.runs.distinctFileLogNames.queryOptions({
      organizationId: orgId,
      projectName,
    })
  );
}

/**
 * Fetch file log names scoped to specific runs (SQID-encoded).
 * Returns ALL file log names for the given runs — no limit.
 */
export function useRunFileLogNames(orgId: string, projectName: string, runIds: string[]) {
  return useQuery(
    trpc.runs.distinctFileLogNames.queryOptions(
      {
        organizationId: orgId,
        projectName,
        runIds,
      },
      {
        enabled: runIds.length > 0,
      },
    )
  );
}

/**
 * Search file log names server-side via fuzzy matching. Only fires when search is non-empty.
 */
export function useSearchFileLogNames(orgId: string, projectName: string, search: string) {
  return useQuery(
    trpc.runs.distinctFileLogNames.queryOptions(
      {
        organizationId: orgId,
        projectName,
        search,
      },
      {
        enabled: search.length > 0,
        staleTime: 60 * 1000,
        placeholderData: (prev) => prev,
      },
    )
  );
}

/**
 * Search file log names server-side using PostgreSQL regex (~).
 * Only fires when regex is non-empty and valid.
 */
export function useRegexSearchFileLogNames(orgId: string, projectName: string, regex: string) {
  return useQuery(
    trpc.runs.distinctFileLogNames.queryOptions(
      {
        organizationId: orgId,
        projectName,
        regex,
      },
      {
        enabled: regex.length > 0,
        staleTime: 60 * 1000,
        placeholderData: (prev) => prev,
      },
    )
  );
}
