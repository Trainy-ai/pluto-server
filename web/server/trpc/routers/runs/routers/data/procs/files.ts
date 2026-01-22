import { z } from "zod";
import { protectedOrgProcedure } from "../../../../../../lib/trpc";
import { sqidDecode } from "../../../../../../lib/sqid";
import { getLogGroupName } from "../../../../../../lib/utilts";
import { getImageUrl } from "../../../../../../lib/s3";
import { withCache } from "../../../../../../lib/cache";

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
    const clickhouse = ctx.clickhouse;
    const { runId: encodedRunId, projectName, organizationId, logName } = input;

    const runId = sqidDecode(encodedRunId);
    const logGroup = getLogGroupName(logName);

    return withCache<FileData>(
      ctx,
      "files",
      { runId, organizationId, projectName, logName, logGroup },
      async () => {
        const query = `
          SELECT time, step, fileName, fileType
          FROM mlop_files
          WHERE tenantId = {tenantId: String}
          AND projectName = {projectName: String}
          AND runId = {runId: UInt64}
          AND logName = {logName: String}
          AND logGroup = {logGroup: String}
          ORDER BY step ASC
        `;

        const files = await clickhouse.query(query, {
          tenantId: organizationId,
          projectName: projectName,
          runId: runId,
          logName: logName,
          logGroup: logGroup,
        });

        const filesData = (await files.json()) as {
          time: string;
          step: number;
          fileName: string;
          fileType: string;
        }[];

        // Generate URLs for all files in parallel
        const filesWithUrls = await Promise.all(
          filesData.map(async (file) => {
            const url = await getImageUrl(
              organizationId,
              projectName,
              runId,
              logName,
              file.fileName
            );
            return {
              ...file,
              url,
            };
          })
        );

        return filesWithUrls;
      },
      { maxTtlMs: S3_URL_MAX_TTL_MS }
    );
  });
