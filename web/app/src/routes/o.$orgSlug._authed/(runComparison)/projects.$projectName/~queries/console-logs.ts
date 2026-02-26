import { trpc } from "@/utils/trpc";
import { useQuery } from "@tanstack/react-query";

/**
 * Fetch console logs for a single run, optionally filtered by ClickHouse logType
 * ("INFO" for stdout, "ERROR" for stderr — uppercase to match ClickHouse data).
 */
export function useConsoleLogs(
  organizationId: string,
  projectName: string,
  runId: string,
  logType?: string,
) {
  return useQuery(
    trpc.runs.data.logs.queryOptions({
      organizationId,
      projectName,
      runId,
      logType,
    }),
  );
}
