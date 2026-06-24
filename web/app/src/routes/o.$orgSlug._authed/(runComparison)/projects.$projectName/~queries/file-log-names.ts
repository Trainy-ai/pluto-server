import { trpc } from "@/utils/trpc";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

export interface EligiblePrefixEntry {
  prefix: string;
  suffixCount: number;
}

/**
 * Eligible {bars} prefixes for the Add-Widget Files dropdown.
 *
 * Uses a SINGLE project-wide `runs.data.eligiblePrefixes` call (runId
 * omitted). The project-wide result counts distinct children across every
 * run in the project, so for any prefix it is a superset of — and has a
 * suffix count >= — the per-run results: a prefix eligible in any single
 * selected run (>= 3 children there) is necessarily eligible project-wide.
 *
 * We previously fired one query PER selected run in addition to this one and
 * merged the results client-side. On a dashboard with N selected runs that
 * was N+1 ClickHouse round-trips per dynamic section that produced an
 * identical result. Collapsing to the project-wide query alone removes the
 * per-run fan-out with no change in output. (`runIds` is kept on the
 * signature for call-site stability.)
 *
 * The backend proc already returns its prefixes deepest-only (ancestor-
 * suppressed) and sorted by (suffixCount desc, prefix asc), so we use the
 * response directly — no client-side re-merge/re-sort needed.
 *
 * Surfaces deepest prefixes with >= 3 children.
 */
export function useEligiblePrefixesForRuns(
  orgId: string,
  projectName: string,
  runIds: string[],
  enabled: boolean = true,
) {
  void runIds; // retained for call-site stability; see doc comment above

  const projectQuery = useQuery(
    trpc.runs.data.eligiblePrefixes.queryOptions(
      { organizationId: orgId, projectName },
      {
        enabled: enabled && (projectName?.length ?? 0) > 0,
        staleTime: 1000 * 30,
      },
    ),
  );

  // useMemo only to keep a stable [] identity while loading (avoids
  // downstream churn); the loaded value is used as-is from the server.
  const merged = useMemo<EligiblePrefixEntry[]>(
    () => (projectQuery.data as EligiblePrefixEntry[] | undefined) ?? [],
    [projectQuery.data],
  );

  const isLoading = projectQuery.isLoading;
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
