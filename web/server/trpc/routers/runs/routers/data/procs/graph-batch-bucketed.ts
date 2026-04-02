import { z } from "zod";
import { protectedOrgProcedure } from "../../../../../../lib/trpc";
import { resolveRunId } from "../../../../../../lib/resolve-run-id";
import { queryRunMetricsBatchBucketedByLogName } from "../../../../../../lib/queries";
import type { BucketedMetricDataPoint } from "../../../../../../lib/queries";
import { withBatchCache } from "../../../../../../lib/cache";
import { queryLineageBucketed } from "./lineage-helpers";

// Type for batch bucketed graph data: map of encoded runId → bucketed data points
type GraphBatchBucketedData = Record<string, BucketedMetricDataPoint[]>;

export const graphBatchBucketedProcedure = protectedOrgProcedure
  .input(
    z.object({
      runIds: z.array(z.string()).min(1).max(200),
      projectName: z.string(),
      logName: z.string(),
      buckets: z.number().int().min(10).max(20000).optional(),
      stepMin: z.number().int().nonnegative().optional(),
      stepMax: z.number().int().nonnegative().optional(),
      preview: z.boolean().optional(),
      includeLineage: z.boolean().optional(),
      algorithm: z.enum(["avg", "lttb"]).optional(),
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
      includeLineage,
      algorithm,
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

    // Use lineage stitching only when explicitly requested (showInheritedMetrics toggle)
    // For preview/zoom queries, always use the fast batch query
    if (!includeLineage || preview || (stepMin !== undefined && stepMax !== undefined)) {
      return withBatchCache(
        ctx,
        "graphBatchBucketed",
        { runIds: numericRunIds, organizationId, projectName, logName, buckets, stepMin, stepMax, preview, algorithm },
        async () => {
          const grouped = await queryRunMetricsBatchBucketedByLogName(ctx.clickhouse, {
            organizationId,
            projectName,
            runIds: numericRunIds,
            logName,
            buckets,
            stepMin,
            stepMax,
            preview,
            algorithm,
          });

          const result: GraphBatchBucketedData = {};
          for (const [numericId, points] of Object.entries(grouped)) {
            const encoded = numericToEncoded.get(Number(numericId));
            if (encoded) {
              result[encoded] = points;
            }
          }
          return result;
        },
      );
    }

    // Normal path: lineage-aware queries per run so forked runs
    // include inherited metrics from parent runs.
    return withBatchCache(
      ctx,
      "graphBatchBucketedLineage",
      { runIds: numericRunIds, organizationId, projectName, logName, buckets },
      async () => {
        const result: GraphBatchBucketedData = {};
        await Promise.all(
          numericRunIds.map(async (numericId) => {
            const encoded = numericToEncoded.get(numericId);
            if (!encoded) return;
            const points = await queryLineageBucketed(
              ctx.clickhouse,
              ctx.prisma,
              { organizationId, projectName, runId: numericId, logName, buckets },
            );
            result[encoded] = points;
          }),
        );
        return result;
      },
    );
  });
