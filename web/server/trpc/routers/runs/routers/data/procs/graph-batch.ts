import { z } from "zod";
import { protectedOrgProcedure } from "../../../../../../lib/trpc";
import { resolveRunId } from "../../../../../../lib/resolve-run-id";
import { queryRunMetricsBatchByLogName } from "../../../../../../lib/queries";

// Type for batch graph data: map of encoded runId → data points
type GraphBatchData = Record<
  string,
  { value: number; valueFlag: string; time: string; step: number }[]
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

    // Resolve run identifiers (display IDs like "MMP-7" or SQIDs) → numeric IDs
    const numericRunIds = await Promise.all(
      encodedRunIds.map((id) => resolveRunId(ctx.prisma, id, organizationId, projectName))
    );

    // Build reverse map: numeric → encoded ID
    const numericToEncoded = new Map<number, string>();
    encodedRunIds.forEach((encoded, i) => {
      numericToEncoded.set(numericRunIds[i], encoded);
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

    // Re-key results by encoded runId
    const result: GraphBatchData = {};
    for (const [numericId, points] of Object.entries(grouped)) {
      const encoded = numericToEncoded.get(Number(numericId));
      if (encoded) {
        result[encoded] = points;
      }
    }

    return result;
  });
