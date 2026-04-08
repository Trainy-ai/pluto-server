import { z } from "zod";
import { protectedOrgProcedure } from "../../../../../../lib/trpc";
import { resolveRunId } from "../../../../../../lib/resolve-run-id";
import { queryRunMetricsMultiMetricBatchBucketed, toColumnar } from "../../../../../../lib/queries";
import type { ColumnarBucketedSeries, DownsamplingAlgorithm } from "../../../../../../lib/queries";
import { withBatchCache } from "../../../../../../lib/cache";
import { queryLineageBucketed } from "./lineage-helpers";

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
      includeLineage: z.boolean().optional(),
      algorithm: z.enum(["avg", "lttb"]).optional(),
      dedup: z.boolean().optional(),
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
      includeLineage,
      algorithm,
      dedup,
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

    // For preview/zoom, use the fast batch query (no lineage stitching)
    const isZoomOrPreview = !includeLineage || preview || (stepMin !== undefined && stepMax !== undefined);

    const result = await withBatchCache<GraphMultiMetricBatchBucketedData>(
      ctx,
      isZoomOrPreview ? "graphMultiMetricBatchBucketed" : "graphMultiMetricBatchBucketedLineage",
      {
        runIds: numericRunIds,
        organizationId,
        projectName,
        logNames: logNames as unknown as string[],
        buckets: buckets ?? 0,
        stepMin: stepMin ?? -1,
        stepMax: stepMax ?? -1,
        preview: preview ?? false,
        algorithm: algorithm ?? "avg",
        dedup: dedup ?? false,
      },
      async () => {
        if (isZoomOrPreview) {
          // Fast path: single ClickHouse query, no lineage stitching
          const grouped = await queryRunMetricsMultiMetricBatchBucketed(ctx.clickhouse, {
            organizationId,
            projectName,
            runIds: numericRunIds,
            logNames,
            buckets,
            stepMin,
            stepMax,
            preview,
            algorithm,
            dedup,
          });

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
        }

        // Normal path: lineage-aware per-run queries for inherited metric stitching
        const data: GraphMultiMetricBatchBucketedData = {};
        await Promise.all(
          logNames.flatMap((logName) =>
            numericRunIds.map(async (numericId) => {
              const encoded = numericToEncoded.get(numericId);
              if (!encoded) return;
              const points = await queryLineageBucketed(
                ctx.clickhouse,
                ctx.prisma,
                { organizationId, projectName, runId: numericId, logName, buckets },
              );
              if (points.length > 0) {
                if (!data[logName]) data[logName] = {};
                data[logName][encoded] = toColumnar(points);
              }
            }),
          ),
        );
        return data;
      },
    );

    // Tag as JSON-safe to skip superjson's expensive object graph traversal
    // (chart data is all plain numbers/strings — no Dates, BigInts, Maps)
    return { ...result, __json_safe: true } as unknown as typeof result;
  });
