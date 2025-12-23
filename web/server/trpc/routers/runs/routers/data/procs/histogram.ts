import { z } from "zod";
import { protectedOrgProcedure } from "../../../../../../lib/trpc";
import { sqidDecode } from "../../../../../../lib/sqid";

const histogramSchema = z.object({
  freq: z.array(z.number().int()),
  bins: z.object({
    min: z.number(),
    max: z.number(),
    num: z.number().int(),
  }),
  shape: z.literal("uniform"), // Only allows the string "uniform"
  type: z.literal("Histogram"), // Only allows the string "Histogram"
  maxFreq: z.number().int(),
});

const histogramDataRow = z.object({
  logName: z.string(),
  time: z.string().transform((str) => new Date(str + "Z")),
  step: z.string().transform((str) => parseInt(str, 10)),
  histogramData: z.string().transform((str) => {
    const parsed = JSON.parse(str);
    return histogramSchema.parse(parsed);
  }),
});

export const histogramProcedure = protectedOrgProcedure
  .input(
    z.object({
      runId: z.string(),
      projectName: z.string(),
      logName: z.string(),
    })
  )
  .query(async ({ ctx, input }) => {
    const { runId: encodedRunId, projectName, organizationId, logName } = input;
    const runId = sqidDecode(encodedRunId);

    const query = `
    SELECT logName, time, step, data as histogramData FROM mlop_data
    WHERE tenantId = {tenantId: String}
    AND projectName = {projectName: String}
    AND runId = {runId: UInt64}
    AND logName = {logName: String}
    AND dataType = 'HISTOGRAM'
  `;

    const result = (await ctx.clickhouse
      .query(query, {
        tenantId: organizationId,
        projectName,
        runId,
        logName,
      })
      .then((result) => result.json())) as unknown[];

    const data = result.map((row) => histogramDataRow.parse(row));

    return data;
  });
