import { trpc } from "@/utils/trpc";
import { useQuery } from "@tanstack/react-query";

/**
 * Batch fetch pre-flattened field values (config + systemMetadata) for visible runs.
 * Returns Record<runId, Record<"source::key", value>>.
 *
 * This replaces the old pattern of sending full JSON blobs in runs.list and
 * flattening them client-side.  The run_field_values table already stores
 * the data pre-flattened and indexed.
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
