import { z } from "zod";
import { protectedOrgProcedure } from "../../../../../../lib/trpc";
import { sqidDecode } from "../../../../../../lib/sqid";
import { getLogGroupName } from "../../../../../../lib/utilts";
import { getImageUrl } from "../../../../../../lib/s3";

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

    console.log(filesWithUrls);

    return filesWithUrls;
  });
