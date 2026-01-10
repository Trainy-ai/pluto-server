import { trpc, trpcClient } from "@/utils/trpc";
import { useQuery } from "@tanstack/react-query";

export const useRunCount = (
  orgId: string,
  projectName: string,
  tags?: string[],
  status?: string[]
) => {
  return useQuery<number>({
    queryKey: trpc.runs.count.queryKey({
      organizationId: orgId,
      projectName,
      tags: tags && tags.length > 0 ? tags : undefined,
      status: status && status.length > 0 ? status as ("RUNNING" | "COMPLETED" | "FAILED" | "TERMINATED" | "CANCELLED")[] : undefined,
    }),
    queryFn: () =>
      trpcClient.runs.count.query({
        organizationId: orgId,
        projectName,
        tags: tags && tags.length > 0 ? tags : undefined,
        status: status && status.length > 0 ? status as ("RUNNING" | "COMPLETED" | "FAILED" | "TERMINATED" | "CANCELLED")[] : undefined,
      }),
  });
};
