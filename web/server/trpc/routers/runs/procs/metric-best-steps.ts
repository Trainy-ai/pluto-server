import { z } from "zod";
import { protectedOrgProcedure } from "../../../../lib/trpc";
import {
  queryArgminArgmaxSteps,
  queryArgminArgmaxStepsPerImageLog,
} from "../../../../lib/queries/metric-summaries";
import { sqidDecode } from "../../../../lib/sqid";

/**
 * Find the step where a metric reaches its min/max value for each run.
 *
 * - Default: returns one argmin/argmax step per run (same step applied across
 *   all image widgets).
 * - `perWidget: true`: returns one argmin/argmax step per (run, imageLogName)
 *   pair, so each image widget can be pinned at its own best step.
 *
 * When `perWidget` is set, `requireImage` is implicitly true (the per-widget
 * query joins on mlop_files and only considers steps with an image).
 */
export const metricBestStepsProcedure = protectedOrgProcedure
  .input(
    z.object({
      projectName: z.string(),
      logName: z.string(),
      runIds: z.array(z.string()), // SQID-encoded run IDs
      requireImage: z.boolean().optional(),
      perWidget: z.boolean().optional(),
    })
  )
  .query(async ({ ctx, input }) => {
    if (input.runIds.length === 0) {
      return { bestSteps: [], perWidgetBestSteps: [] };
    }

    const numericRunIds = input.runIds.map((sqid) => sqidDecode(sqid));

    if (input.perWidget) {
      const rows = await queryArgminArgmaxStepsPerImageLog(ctx.clickhouse, {
        organizationId: input.organizationId,
        projectName: input.projectName,
        logName: input.logName,
        runIds: numericRunIds,
      });

      // Map numeric runIds back to SQIDs
      const perWidgetBestSteps = rows
        .map((r) => {
          const idx = numericRunIds.indexOf(r.runId);
          if (idx < 0) return null;
          return {
            runId: input.runIds[idx],
            imageLogName: r.imageLogName,
            argminStep: r.argminStep,
            argmaxStep: r.argmaxStep,
          };
        })
        .filter((r): r is NonNullable<typeof r> => r !== null);

      return { bestSteps: [], perWidgetBestSteps };
    }

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
      .filter((r): r is NonNullable<typeof r> => r !== null);

    return { bestSteps, perWidgetBestSteps: [] };
  });
