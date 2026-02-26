import { trpc } from "@/utils/trpc";
import { useQuery } from "@tanstack/react-query";

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
