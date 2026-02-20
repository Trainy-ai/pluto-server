import { trpc } from "@/utils/trpc";
import { useQuery } from "@tanstack/react-query";

export const useGetFileUrl = (
  orgId: string,
  projectName: string,
  runId: string,
  logName: string,
  fileName: string,
) =>
  useQuery({
    ...trpc.runs.data.fileUrl.queryOptions({
      organizationId: orgId,
      projectName: projectName,
      runId: runId,
      logName: logName,
      fileName: fileName,
    }),
    staleTime: 1000 * 60 * 10, // 10 minutes - URLs are valid for 5 days
  });
