import { z } from "zod";
import { protectedOrgProcedure } from "../../../../../../lib/trpc";
import { resolveRunId } from "../../../../../../lib/resolve-run-id";
import { withCache } from "../../../../../../lib/cache";
import { histogramDataRow } from "./histogram.schema";

type HistogramData = z.infer<typeof histogramDataRow>[];

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
    const runId = await resolveRunId(ctx.prisma, encodedRunId, organizationId, projectName);

    return withCache<HistogramData>(
      ctx,
      "histogram",
      { runId, organizationId, projectName, logName },
      async () => {
        const query = `
          SELECT logName, time, step, data as histogramData FROM mlop_data
          WHERE tenantId = {tenantId: String}
          AND projectName = {projectName: String}
          AND runId = {runId: UInt64}
          AND logName = {logName: String}
          AND dataType ILIKE 'histogram'
        `;

        const result = (await ctx.clickhouse
          .query(query, {
            tenantId: organizationId,
            projectName,
            runId,
            logName,
          })
          .then((result) => result.json())) as unknown[];

        return result.map((row) => histogramDataRow.parse(row));
      }
    );
  });
