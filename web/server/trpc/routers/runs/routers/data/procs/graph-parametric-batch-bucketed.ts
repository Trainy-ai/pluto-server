import { z } from "zod";
import { protectedOrgProcedure } from "../../../../../../lib/trpc";
import { resolveRunId } from "../../../../../../lib/resolve-run-id";
import {
  queryRunMetricsParametricBatchBucketed,
  queryRunsWithMetric,
  toColumnarParametric,
} from "../../../../../../lib/queries";
import type { ColumnarParametricSeries } from "../../../../../../lib/queries";
import { withBatchCache } from "../../../../../../lib/cache";

/** logName → encoded runId → columnar parametric series */
type ParametricSeriesMap = Record<string, Record<string, ColumnarParametricSeries>>;

interface GraphParametricBatchBucketedData {
  series: ParametricSeriesMap;
  /** Encoded runIds that logged the x-axis metric at all. A run missing here
   *  never logged it; a run present here but absent from `series` logged it
   *  but shares no steps with the y-metric. The frontend needs the two apart
   *  to explain the empty chart. */
  runsWithXMetric: string[];
}

export const graphParametricBatchBucketedProcedure = protectedOrgProcedure
  .input(
    z.object({
      runIds: z.array(z.string()).min(1).max(200),
      projectName: z.string(),
      logNames: z.array(z.string()).min(1).max(200),
      /** logName supplying the x coordinate (the parametric axis) */
      xMetric: z.string().min(1),
      buckets: z.number().int().min(10).max(3000).optional(),
      stepMin: z.number().int().nonnegative().optional(),
      stepMax: z.number().int().nonnegative().optional(),
      /** Zoom window on the x-metric's VALUE — what a drag-zoom on a
       *  parametric chart actually selects. */
      xMin: z.number().optional(),
      xMax: z.number().optional(),
      preview: z.boolean().optional(),
    })
  )
  .query(async ({ ctx, input }) => {
    const {
      runIds: encodedRunIds,
      projectName,
      organizationId,
      logNames,
      xMetric,
      buckets,
      stepMin,
      stepMax,
      xMin,
      xMax,
      preview,
    } = input;

    // Resolve run identifiers (display IDs like "MMP-7" or SQIDs) → numeric IDs
    const numericRunIds = await Promise.all(
      encodedRunIds.map((id) => resolveRunId(ctx.prisma, id, organizationId, projectName))
    );

    const numericToEncoded = new Map<number, string>();
    encodedRunIds.forEach((encoded, i) => {
      numericToEncoded.set(numericRunIds[i], encoded);
    });

    const result = await withBatchCache<GraphParametricBatchBucketedData>(
      ctx,
      "graphParametricBatchBucketed",
      {
        runIds: numericRunIds,
        organizationId,
        projectName,
        logNames: logNames as unknown as string[],
        xMetric,
        buckets: buckets ?? 0,
        stepMin: stepMin ?? -1,
        stepMax: stepMax ?? -1,
        xMin: xMin ?? Number.NEGATIVE_INFINITY,
        xMax: xMax ?? Number.POSITIVE_INFINITY,
        preview: preview ?? false,
      },
      async () => {
        const [grouped, runsWithX] = await Promise.all([
          queryRunMetricsParametricBatchBucketed(ctx.clickhouse, {
            organizationId,
            projectName,
            runIds: numericRunIds,
            logNames,
            xMetric,
            buckets,
            stepMin,
            stepMax,
            xMin,
            xMax,
            preview,
          }),
          queryRunsWithMetric(ctx.clickhouse, {
            organizationId,
            projectName,
            runIds: numericRunIds,
            logName: xMetric,
          }),
        ]);

        const series: ParametricSeriesMap = {};
        for (const [logName, byNumericRun] of Object.entries(grouped)) {
          const byEncodedRun: Record<string, ColumnarParametricSeries> = {};
          for (const [numericId, points] of Object.entries(byNumericRun)) {
            const encoded = numericToEncoded.get(Number(numericId));
            if (encoded) {
              byEncodedRun[encoded] = toColumnarParametric(points);
            }
          }
          series[logName] = byEncodedRun;
        }

        return {
          series,
          runsWithXMetric: runsWithX
            .map((id) => numericToEncoded.get(id))
            .filter((id): id is string => id !== undefined),
        };
      },
    );

    // Tag as JSON-safe to skip superjson's expensive object graph traversal
    // (chart data is all plain numbers/strings — no Dates, BigInts, Maps)
    return { ...result, __json_safe: true } as unknown as typeof result;
  });
