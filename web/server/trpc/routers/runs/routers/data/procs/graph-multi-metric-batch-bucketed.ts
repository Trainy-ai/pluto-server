import { z } from "zod";
import { protectedOrgProcedure } from "../../../../../../lib/trpc";
import { resolveRunId } from "../../../../../../lib/resolve-run-id";
import { queryRunMetricsMultiMetricBatchBucketed } from "../../../../../../lib/queries";
import type { BucketedMetricDataPoint } from "../../../../../../lib/queries";

// Type for multi-metric batch bucketed graph data: logName → encoded runId → bucketed data points
type GraphMultiMetricBatchBucketedData = Record<string, Record<string, BucketedMetricDataPoint[]>>;

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

    // Re-key results by encoded runId
    const result: GraphMultiMetricBatchBucketedData = {};
    for (const [logName, byNumericRun] of Object.entries(grouped)) {
      const byEncodedRun: Record<string, BucketedMetricDataPoint[]> = {};
      for (const [numericId, points] of Object.entries(byNumericRun)) {
        const encoded = numericToEncoded.get(Number(numericId));
        if (encoded) {
          byEncodedRun[encoded] = points;
        }
      }
      result[logName] = byEncodedRun;
    }

    return result;
  });
