import { z } from "zod";
import { protectedOrgProcedure } from "../../../../../../lib/trpc";
import { resolveRunId } from "../../../../../../lib/resolve-run-id";
import { queryRunMetricsBatchBucketedByLogName } from "../../../../../../lib/queries";
import type { BucketedMetricDataPoint } from "../../../../../../lib/queries";

// Type for batch bucketed graph data: map of encoded runId → bucketed data points
type GraphBatchBucketedData = Record<string, BucketedMetricDataPoint[]>;

export const graphBatchBucketedProcedure = protectedOrgProcedure
  .input(
    z.object({
      runIds: z.array(z.string()).min(1).max(200),
      projectName: z.string(),
      logName: z.string(),
      buckets: z.number().int().min(10).max(5000).optional(),
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
      logName,
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

    const grouped = await queryRunMetricsBatchBucketedByLogName(ctx.clickhouse, {
      organizationId,
      projectName,
      runIds: numericRunIds,
      logName,
      buckets,
      stepMin,
      stepMax,
      preview,
    });

    // Re-key results by encoded runId
    const result: GraphBatchBucketedData = {};
    for (const [numericId, points] of Object.entries(grouped)) {
      const encoded = numericToEncoded.get(Number(numericId));
      if (encoded) {
        result[encoded] = points;
      }
    }

    return result;
  });
