import { z } from "zod";
import { protectedOrgProcedure } from "../../../../../../lib/trpc";
import { sqidDecode } from "../../../../../../lib/sqid";
import { queryRunMetricsBatchBucketedByLogName } from "../../../../../../lib/queries";
import type { BucketedMetricDataPoint } from "../../../../../../lib/queries";

// Type for batch bucketed graph data: map of SQID-encoded runId → bucketed data points
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

    // Decode SQIDs → numeric IDs
    const numericRunIds = encodedRunIds.map((id) => sqidDecode(id));

    // Build reverse map: numeric → SQID
    const numericToSqid = new Map<number, string>();
    encodedRunIds.forEach((sqid, i) => {
      numericToSqid.set(numericRunIds[i], sqid);
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

    // Re-key results by SQID-encoded runId
    const result: GraphBatchBucketedData = {};
    for (const [numericId, points] of Object.entries(grouped)) {
      const sqid = numericToSqid.get(Number(numericId));
      if (sqid) {
        result[sqid] = points;
      }
    }

    return result;
  });
