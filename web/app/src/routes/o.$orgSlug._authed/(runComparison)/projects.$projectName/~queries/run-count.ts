import { trpc, trpcClient } from "@/utils/trpc";
import { useQuery } from "@tanstack/react-query";

export const useRunCount = (orgId: string, projectName: string) => {
  return useQuery<number>({
    queryKey: trpc.runs.count.queryKey({ organizationId: orgId, projectName }),
    queryFn: () =>
      trpcClient.runs.count.query({ organizationId: orgId, projectName }),
  });
};
