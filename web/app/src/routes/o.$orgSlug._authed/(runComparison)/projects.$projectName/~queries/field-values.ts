import { trpc } from "@/utils/trpc";
import { useQuery } from "@tanstack/react-query";

/**
 * Batch fetch pre-flattened field values (config + systemMetadata) for specific runs.
 * Returns Record<runId, Record<"source::key", value>>.
 *
 * Note: For the main runs table, field values now arrive inline with
 * runs.list responses. This hook is kept for ad-hoc use cases that need
 * field values outside the paginated list flow.
 */
export function useFieldValues(
  orgId: string,
  projectName: string,
  runIds: string[],
) {
  // Sort for stable query key
  const sortedIds = [...runIds].sort();

  return useQuery(
    trpc.runs.getFieldValues.queryOptions(
      {
        organizationId: orgId,
        projectName,
        runIds: sortedIds,
      },
      {
        enabled: sortedIds.length > 0,
        staleTime: 5 * 60 * 1000,
        placeholderData: (prev) => prev,
      },
    )
  );
}
