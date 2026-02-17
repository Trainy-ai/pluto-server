import { trpc } from "@/utils/trpc";
import { useQuery } from "@tanstack/react-query";

/**
 * Fetch distinct metric names in a project (for the column picker "Metrics" group).
 */
export function useDistinctMetricNames(orgId: string, projectName: string) {
  return useQuery(
    trpc.runs.distinctMetricNames.queryOptions({
      organizationId: orgId,
      projectName,
    })
  );
}

/**
 * Fetch distinct metric names scoped to specific runs (for side-by-side view).
 * Returns ALL metric names for the given runs — no limit.
 */
export function useRunMetricNames(orgId: string, projectName: string, runIds: string[]) {
  return useQuery(
    trpc.runs.distinctMetricNames.queryOptions(
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
 * Search metric names server-side. Only fires when search is non-empty.
 */
export function useSearchMetricNames(orgId: string, projectName: string, search: string) {
  return useQuery(
    trpc.runs.distinctMetricNames.queryOptions(
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
 * Batch fetch metric summaries for visible runs.
 * Only runs when there are metric columns and visible run IDs.
 */
export function useMetricSummaries(
  orgId: string,
  projectName: string,
  runIds: string[],
  metrics: { logName: string; aggregation: "MIN" | "MAX" | "AVG" | "LAST" | "VARIANCE" }[],
) {
  return useQuery(
    trpc.runs.metricSummaries.queryOptions(
      {
        organizationId: orgId,
        projectName,
        runIds,
        metrics,
      },
      {
        enabled: runIds.length > 0 && metrics.length > 0,
        staleTime: 30 * 1000,
        placeholderData: (prev) => prev,
      },
    )
  );
}
