import { z } from "zod";
import { protectedOrgProcedure } from "../../../../../../lib/trpc";
import { resolveRunId } from "../../../../../../lib/resolve-run-id";
import { getLogGroupName } from "../../../../../../lib/utilts";
import { withCache } from "../../../../../../lib/cache";
import { queryRunFilesByLogName } from "../../../../../../lib/queries";

// S3 presigned URLs typically expire in 15-60 minutes
// Cap cache TTL to ensure URLs don't expire while cached
const S3_URL_MAX_TTL_MS = 15 * 60 * 1000; // 15 minutes

type FileData = {
  time: string;
  step: number;
  fileName: string;
  fileType: string;
  url: string;
}[];

export const filesProcedure = protectedOrgProcedure
  .input(
    z.object({
      runId: z.string(),
      projectName: z.string(),
      logName: z.string(),
    })
  )
  .query(async ({ ctx, input }) => {
    const { runId: encodedRunId, projectName, organizationId, logName } = input;

    const runId = await resolveRunId(ctx.prisma, encodedRunId, organizationId, projectName);
    const logGroup = getLogGroupName(logName);

    return withCache<FileData>(
      ctx,
      "files",
      { runId, organizationId, projectName, logName, logGroup },
      async () => {
        return queryRunFilesByLogName(ctx.clickhouse, {
          organizationId,
          projectName,
          runId,
          logName,
        });
      },
      { maxTtlMs: S3_URL_MAX_TTL_MS }
    );
  });
