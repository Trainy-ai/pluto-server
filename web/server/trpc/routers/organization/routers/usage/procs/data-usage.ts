import type { Context } from "../../../../../../lib/context";
import { limitsSchema } from "../../../../../../lib/limits";
import { protectedOrgProcedure } from "../../../../../../lib/trpc";

export const getDataUsageQuery = async (ctx: Context, tenantId: string) => {
  const DATA_USAGE_QUERY = `
-- add the mlop_logs table
WITH
    -- Average row size per table
    (
        SELECT coalesce(sum(bytes_on_disk), 0) / coalesce(sum(rows), 1)
        FROM system.parts
        WHERE table = 'mlop_metrics'
          AND active = 1
    ) AS avg_row_size_metrics,
    (
        SELECT coalesce(sum(bytes_on_disk), 0) / coalesce(sum(rows), 1)
        FROM system.parts
        WHERE table = 'mlop_data'
          AND active = 1
    ) AS avg_row_size_data,
    (
        SELECT coalesce(sum(bytes_on_disk), 0) / coalesce(sum(rows), 1)
        FROM system.parts
        WHERE table = 'mlop_files'
          AND active = 1
    ) AS avg_row_size_files,
    (
        SELECT coalesce(sum(bytes_on_disk), 0) / coalesce(sum(rows), 1)
        FROM system.parts
        WHERE table = 'mlop_logs'
          AND active = 1
    ) AS avg_row_size_logs
SELECT
    table_name,
    estimated_size_gb
FROM
(
    -- mlop_metrics
    SELECT
        'mlop_metrics' AS table_name,
        count() * avg_row_size_metrics / 1024 / 1024 / 1024 AS estimated_size_gb
    FROM
        mlop_metrics
    WHERE
        tenantId = {tenantId: String}

    UNION ALL

    -- mlop_data
    SELECT
        'mlop_data' AS table_name,
        count() * avg_row_size_data / 1024 / 1024 / 1024 AS estimated_size_gb
    FROM
        mlop_data
    WHERE
        tenantId = {tenantId: String}

    UNION ALL

    -- mlop_files
    SELECT
        'mlop_files' AS table_name,
        count() * avg_row_size_files / 1024 / 1024 / 1024 AS estimated_size_gb
    FROM
        mlop_files
    WHERE
        tenantId = {tenantId: String}

    UNION ALL

    -- mlop_logs
    SELECT
        'mlop_logs' AS table_name,
        count() * avg_row_size_logs / 1024 / 1024 / 1024 AS estimated_size_gb
    FROM
        mlop_logs
    WHERE
        tenantId = {tenantId: String}
)
ORDER BY
    estimated_size_gb DESC;
  `;

  const usage = await ctx.clickhouse.query(DATA_USAGE_QUERY, {
    tenantId,
  });

  const usageData = (await usage.json()) as {
    table_name: string;
    estimated_size_gb: number;
  }[];

  return usageData;
};

export const getFileDataUsageQuery = async (ctx: Context, tenantId: string) => {
  const FILE_DATA_USAGE_QUERY = `
  SELECT
    round(sum(fileSize) / 1024 / 1024 / 1024, 3) AS total_gb
FROM default.mlop_files
WHERE tenantId = {tenantId: String}
GROUP BY tenantId;
  `;

  const usage = await ctx.clickhouse.query(FILE_DATA_USAGE_QUERY, {
    tenantId,
  });

  const usageData = (await usage.json()) as {
    total_gb: number;
  }[];

  const totalGb = usageData[0]?.total_gb || 0;

  return totalGb;
};

export const getOrgLimits = async (ctx: Context, orgId: string) => {
  const orgSubscription = await ctx.prisma.organizationSubscription.findUnique({
    where: {
      organizationId: orgId,
    },
  });

  if (!orgSubscription) {
    throw new Error("Organization subscription not found");
  }

  const limits = limitsSchema.parse(orgSubscription.usageLimits);

  return limits;
};

export const dataUsageProcedure = protectedOrgProcedure.query(
  async ({ ctx, input }) => {
    const { organizationId } = input;

    const [tableUsage, fileUsage, orgLimits] = await Promise.all([
      getDataUsageQuery(ctx, organizationId),
      getFileDataUsageQuery(ctx, organizationId),
      getOrgLimits(ctx, organizationId),
    ]);

    // Calculate total usage across all tables
    const totalTableUsage = tableUsage.reduce(
      (acc, curr) => acc + curr.estimated_size_gb,
      0
    );

    const totalUsage = totalTableUsage + fileUsage;
    const percentUsage = (totalUsage / orgLimits.dataUsageGB) * 100;

    return {
      totalStorageGb: totalUsage,
      percentUsage,
      orgLimits,
      breakdown: {
        fileStorageGb: fileUsage,
        tableStorageGb: totalTableUsage,
        tableDetails: tableUsage.reduce(
          (acc, curr) => {
            acc[curr.table_name.replace("mlop_", "")] =
              curr.estimated_size_gb ?? 0;
            return acc;
          },
          {} as Record<string, number>
        ),
      },
    };
  }
);
