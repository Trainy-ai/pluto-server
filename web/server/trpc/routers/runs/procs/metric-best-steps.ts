import { z } from "zod";
import { protectedOrgProcedure } from "../../../../lib/trpc";
import {
  queryArgminArgmaxSteps,
  queryArgminArgmaxStepsPerImageLog,
  type BestStepEntry,
} from "../../../../lib/queries/metric-summaries";
import { sqidDecode } from "../../../../lib/sqid";

/**
 * Find the step where a metric reaches its min/max value for each run.
 *
 * - `perWidget=false` — plain argmin/argmax on the metric, no image
 *   coupling. Pure summaries lookup, `toleranceSteps` is ignored.
 * - `perWidget=true` — nearest-snap per (run, imageLogName) pair so each
 *   image widget gets its own best step. For every metric row, the
 *   nearest image step is computed; rows beyond `toleranceSteps` are
 *   dropped, then argMin/argMax is taken over the survivors. Handles the
 *   offset-cadence pattern (metrics at {0,10,20...}, images at
 *   {5,15,25...} — never overlap but always within cadence/2).
 *
 * `toleranceUsed` is echoed back so the frontend can show it in pin
 * tooltips.
 */
export const metricBestStepsProcedure = protectedOrgProcedure
  .input(
    z.object({
      projectName: z.string(),
      logName: z.string(),
      runIds: z.array(z.string()), // SQID-encoded run IDs
      perWidget: z.boolean().optional(),
      /**
       * Max step distance between a metric row and its nearest image,
       * consulted only by the per-widget variant. Owned by the client
       * (currently localStorage-backed per project) — the backend
       * doesn't persist it.
       */
      toleranceSteps: z.number().int().min(0).max(100000),
    })
  )
  .query(async ({ ctx, input }) => {
    if (input.runIds.length === 0) {
      return {
        bestSteps: [],
        perWidgetBestSteps: [],
        toleranceUsed: input.toleranceSteps,
      };
    }

    const { toleranceSteps } = input;
    const numericRunIds = input.runIds.map((sqid) => sqidDecode(sqid));
    const numericToSqid = new Map<number, string>();
    for (let i = 0; i < numericRunIds.length; i++) {
      numericToSqid.set(numericRunIds[i], input.runIds[i]);
    }

    // Shared serializer: convert a BestStepEntry from the query into the
    // output schema (plain object with number | null fields).
    const toOutput = (e: BestStepEntry) => ({
      metricStep: e.metricStep,
      metricValue: e.metricValue,
      imageStep: e.imageStep,
      distance: e.distance,
      tiedAlternativeImageStep: e.tiedAlternativeImageStep,
    });

    if (input.perWidget) {
      const rows = await queryArgminArgmaxStepsPerImageLog(ctx.clickhouse, {
        organizationId: input.organizationId,
        projectName: input.projectName,
        logName: input.logName,
        runIds: numericRunIds,
        toleranceSteps,
      });

      const perWidgetBestSteps = rows
        .map((r) => {
          const sqid = numericToSqid.get(r.runId);
          if (!sqid) return null;
          return {
            runId: sqid,
            imageLogName: r.imageLogName,
            argmin: toOutput(r.argmin),
            argmax: toOutput(r.argmax),
          };
        })
        .filter((r): r is NonNullable<typeof r> => r !== null);

      return { bestSteps: [], perWidgetBestSteps, toleranceUsed: toleranceSteps };
    }

    const resultMap = await queryArgminArgmaxSteps(ctx.clickhouse, {
      organizationId: input.organizationId,
      projectName: input.projectName,
      logName: input.logName,
      runIds: numericRunIds,
    });

    const bestSteps = input.runIds
      .map((sqid, idx) => {
        const data = resultMap.get(numericRunIds[idx]);
        if (!data) return null;
        return {
          runId: sqid,
          argmin: toOutput(data.argmin),
          argmax: toOutput(data.argmax),
        };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);

    return { bestSteps, perWidgetBestSteps: [], toleranceUsed: toleranceSteps };
  });
