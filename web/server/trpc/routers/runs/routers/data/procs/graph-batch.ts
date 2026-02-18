import { z } from "zod";
import { protectedOrgProcedure } from "../../../../../../lib/trpc";
import { sqidDecode, sqidEncode } from "../../../../../../lib/sqid";
import { queryRunMetricsBatchByLogName } from "../../../../../../lib/queries";

// Type for batch graph data: map of SQID-encoded runId → data points
type GraphBatchData = Record<
  string,
  { value: number; time: string; step: number }[]
>;

export const graphBatchProcedure = protectedOrgProcedure
  .input(
    z.object({
      runIds: z.array(z.string()).min(1).max(200),
      projectName: z.string(),
      logName: z.string(),
      stepMin: z.number().int().nonnegative().optional(),
      stepMax: z.number().int().nonnegative().optional(),
      maxPoints: z.number().int().nonnegative().max(10_000_000).optional(),
      preview: z.boolean().optional(),
    })
  )
  .query(async ({ ctx, input }) => {
    const {
      runIds: encodedRunIds,
      projectName,
      organizationId,
      logName,
      stepMin,
      stepMax,
      maxPoints,
      preview,
    } = input;

    // Decode SQIDs → numeric IDs
    const numericRunIds = encodedRunIds.map((id) => sqidDecode(id));

    // Build reverse map: numeric → SQID
    const numericToSqid = new Map<number, string>();
    encodedRunIds.forEach((sqid, i) => {
      numericToSqid.set(numericRunIds[i], sqid);
    });

    const grouped = await queryRunMetricsBatchByLogName(ctx.clickhouse, {
      organizationId,
      projectName,
      runIds: numericRunIds,
      logName,
      stepMin,
      stepMax,
      maxPoints,
      preview,
    });

    // Re-key results by SQID-encoded runId
    const result: GraphBatchData = {};
    for (const [numericId, points] of Object.entries(grouped)) {
      const sqid = numericToSqid.get(Number(numericId));
      if (sqid) {
        result[sqid] = points;
      }
    }

    return result;
  });
