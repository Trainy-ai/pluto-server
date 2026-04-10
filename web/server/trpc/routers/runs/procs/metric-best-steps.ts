import { z } from "zod";
import { protectedOrgProcedure } from "../../../../lib/trpc";
import { queryArgminArgmaxSteps } from "../../../../lib/queries/metric-summaries";
import { sqidDecode } from "../../../../lib/sqid";

/**
 * Find the step where a metric reaches its min/max value for each run.
 * Returns argmin and argmax steps per run (SQID-keyed).
 */
export const metricBestStepsProcedure = protectedOrgProcedure
  .input(
    z.object({
      projectName: z.string(),
      logName: z.string(),
      runIds: z.array(z.string()), // SQID-encoded run IDs
      requireImage: z.boolean().optional(),
    })
  )
  .query(async ({ ctx, input }) => {
    if (input.runIds.length === 0) {
      return { bestSteps: [] };
    }

    const numericRunIds = input.runIds.map((sqid) => sqidDecode(sqid));

    const resultMap = await queryArgminArgmaxSteps(ctx.clickhouse, {
      organizationId: input.organizationId,
      projectName: input.projectName,
      logName: input.logName,
      runIds: numericRunIds,
      requireImage: input.requireImage,
    });

    const bestSteps = input.runIds
      .map((sqid, idx) => {
        const data = resultMap.get(numericRunIds[idx]);
        if (!data) return null;
        return {
          runId: sqid,
          argminStep: data.argminStep,
          argmaxStep: data.argmaxStep,
        };
      })
      .filter(Boolean);

    return { bestSteps };
  });
