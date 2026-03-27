import { z } from "zod";
import { protectedOrgProcedure } from "../../../../../../lib/trpc";
import { resolveRunId } from "../../../../../../lib/resolve-run-id";
import { queryRunMetricsMultiMetricBatchBucketed, toColumnar } from "../../../../../../lib/queries";
import type { ColumnarBucketedSeries } from "../../../../../../lib/queries";
import { withBatchCache } from "../../../../../../lib/cache";

// Type for multi-metric batch bucketed graph data: logName → encoded runId → columnar series
type GraphMultiMetricBatchBucketedData = Record<string, Record<string, ColumnarBucketedSeries>>;

export const graphMultiMetricBatchBucketedProcedure = protectedOrgProcedure
  .input(
    z.object({
      runIds: z.array(z.string()).min(1).max(200),
      projectName: z.string(),
      logNames: z.array(z.string()).min(1).max(200),
      buckets: z.number().int().min(10).max(20000).optional(),
      stepMin: z.number().int().nonnegative().optional(),
      stepMax: z.number().int().nonnegative().optional(),
      preview: z.boolean().optional(),
    })
  )
  .query(async ({ ctx, input }) => {
    const {
      runIds: encodedRunIds,
      projectName,
      organizationId,
      logNames,
      buckets,
      stepMin,
      stepMax,
      preview,
    } = input;

    // Resolve run identifiers (display IDs like "MMP-7" or SQIDs) → numeric IDs
    const numericRunIds = await Promise.all(
      encodedRunIds.map((id) => resolveRunId(ctx.prisma, id, organizationId, projectName))
    );

    // Build reverse map: numeric → encoded ID
    const numericToEncoded = new Map<number, string>();
    encodedRunIds.forEach((encoded, i) => {
      numericToEncoded.set(numericRunIds[i], encoded);
    });

    const result = await withBatchCache<GraphMultiMetricBatchBucketedData>(
      ctx,
      "graphMultiMetricBatchBucketed",
      {
        runIds: numericRunIds,
        organizationId,
        projectName,
        logNames: logNames as unknown as string[],
        buckets: buckets ?? 0,
        stepMin: stepMin ?? -1,
        stepMax: stepMax ?? -1,
        preview: preview ?? false,
      },
      async () => {
        const grouped = await queryRunMetricsMultiMetricBatchBucketed(ctx.clickhouse, {
          organizationId,
          projectName,
          runIds: numericRunIds,
          logNames,
          buckets,
          stepMin,
          stepMax,
          preview,
        });

        // Re-key results by encoded runId and convert to columnar format
        const data: GraphMultiMetricBatchBucketedData = {};
        for (const [logName, byNumericRun] of Object.entries(grouped)) {
          const byEncodedRun: Record<string, ColumnarBucketedSeries> = {};
          for (const [numericId, points] of Object.entries(byNumericRun)) {
            const encoded = numericToEncoded.get(Number(numericId));
            if (encoded) {
              byEncodedRun[encoded] = toColumnar(points);
            }
          }
          data[logName] = byEncodedRun;
        }
        return data;
      },
    );

    // Tag as JSON-safe to skip superjson's expensive object graph traversal
    // (chart data is all plain numbers/strings — no Dates, BigInts, Maps)
    return { ...result, __json_safe: true } as unknown as typeof result;
  });
