import { z } from "zod";
import { protectedOrgProcedure } from "../../../../../../lib/trpc";
import { resolveRunId } from "../../../../../../lib/resolve-run-id";
import { getLogGroupName } from "../../../../../../lib/utilts";
import { withCache } from "../../../../../../lib/cache";
import { queryRunMetricsBucketedByLogName } from "../../../../../../lib/queries";
import type { BucketedMetricDataPoint } from "../../../../../../lib/queries";

export const graphBucketedProcedure = protectedOrgProcedure
  .input(
    z.object({
      runId: z.string(),
      projectName: z.string(),
      logName: z.string(),
      buckets: z.number().int().min(10).max(5000).optional(),
      stepMin: z.number().int().nonnegative().optional(),
      stepMax: z.number().int().nonnegative().optional(),
      preview: z.boolean().optional(),
    })
  )
  .query(async ({ ctx, input }) => {
    const { runId: encodedRunId, projectName, organizationId, logName, buckets, stepMin, stepMax, preview } = input;

    const runId = await resolveRunId(ctx.prisma, encodedRunId, organizationId, projectName);
    const logGroup = getLogGroupName(logName);

    // Preview queries and step-range queries bypass cache
    if (preview || (stepMin !== undefined && stepMax !== undefined)) {
      return queryRunMetricsBucketedByLogName(ctx.clickhouse, {
        organizationId,
        projectName,
        runId,
        logName,
        buckets,
        stepMin,
        stepMax,
        preview,
      });
    }

    return withCache<BucketedMetricDataPoint[]>(
      ctx,
      "graphBucketed",
      { runId, organizationId, projectName, logName, logGroup, buckets },
      async () => {
        return queryRunMetricsBucketedByLogName(ctx.clickhouse, {
          organizationId,
          projectName,
          runId,
          logName,
          buckets,
        });
      }
    );
  });
