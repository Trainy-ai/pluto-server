import { z } from "zod";
import { protectedOrgProcedure } from "../../../../lib/trpc";
import { queryMetricSummariesBatch, type MetricAggregation } from "../../../../lib/queries/metric-summaries";
import { sqidDecode } from "../../../../lib/sqid";

const aggregationEnum = z.enum(["MIN", "MAX", "AVG", "LAST", "VARIANCE"]);

/**
 * Batch fetch metric summaries for visible runs.
 * Input accepts SQID-encoded run IDs (as displayed in the frontend).
 * Returns { [numericRunId]: { "logName|AGG": value } }
 */
export const metricSummariesProcedure = protectedOrgProcedure
  .input(
    z.object({
      projectName: z.string(),
      runIds: z.array(z.string()), // SQID-encoded run IDs
      metrics: z.array(
        z.object({
          logName: z.string(),
          aggregation: aggregationEnum,
        })
      ),
    })
  )
  .query(async ({ ctx, input }) => {
    if (input.runIds.length === 0 || input.metrics.length === 0) {
      return { summaries: {} };
    }

    // Decode SQIDs to numeric IDs
    const numericRunIds = input.runIds.map((sqid) => sqidDecode(sqid));

    const resultMap = await queryMetricSummariesBatch(ctx.clickhouse, {
      organizationId: input.organizationId,
      projectName: input.projectName,
      metrics: input.metrics as { logName: string; aggregation: MetricAggregation }[],
      runIds: numericRunIds,
    });

    // Convert Map to plain object for JSON serialization, keyed by SQID
    const summaries: Record<string, Record<string, number>> = {};
    for (const [numericId, metricsMap] of resultMap) {
      // Find the SQID for this numeric ID
      const idx = numericRunIds.indexOf(numericId);
      const sqid = idx >= 0 ? input.runIds[idx] : String(numericId);
      summaries[sqid] = Object.fromEntries(metricsMap);
    }

    return { summaries };
  });
