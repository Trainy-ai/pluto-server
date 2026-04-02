import { z } from "zod";
import { protectedOrgProcedure } from "../../../../../../lib/trpc";
import { resolveRunId } from "../../../../../../lib/resolve-run-id";
import { getLogGroupName } from "../../../../../../lib/utilts";
import { withCache } from "../../../../../../lib/cache";
import { queryRunMetricsBucketedByLogName, queryLineageMetricsBucketedByLogName } from "../../../../../../lib/queries";
import type { BucketedMetricDataPoint } from "../../../../../../lib/queries";

export const graphBucketedProcedure = protectedOrgProcedure
  .input(
    z.object({
      runId: z.string(),
      projectName: z.string(),
      logName: z.string(),
      buckets: z.number().int().min(10).max(20000).optional(),
      stepMin: z.number().int().nonnegative().optional(),
      stepMax: z.number().int().nonnegative().optional(),
      preview: z.boolean().optional(),
      algorithm: z.enum(["avg", "lttb"]).optional(),
    })
  )
  .query(async ({ ctx, input }) => {
    const { runId: encodedRunId, projectName, organizationId, logName, buckets, stepMin, stepMax, preview, algorithm } = input;

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
        algorithm,
      });
    }

    return withCache<BucketedMetricDataPoint[]>(
      ctx,
      "graphBucketed",
      { runId, organizationId, projectName, logName, logGroup, buckets, algorithm },
      async () => {
        return queryLineageMetricsBucketedByLogName(ctx.clickhouse, ctx.prisma, {
          organizationId,
          projectName,
          runId,
          logName,
          buckets,
          algorithm,
        });
      }
    );
  });
