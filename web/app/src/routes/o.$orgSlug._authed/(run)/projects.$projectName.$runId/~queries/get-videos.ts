import { useQuery } from "@tanstack/react-query";
import { trpc } from "@/utils/trpc";
import type { inferOutput } from "@trpc/tanstack-react-query";

export type Video = inferOutput<typeof trpc.runs.data.files>[number];

export function useGetVideos(
  tenantId: string,
  projectName: string,
  runId: string,
  logName: string,
) {
  return useQuery(
    trpc.runs.data.files.queryOptions({
      organizationId: tenantId,
      projectName,
      runId,
      logName,
    }),
  );
}
