/**
 * Backfill script to populate mlop_metric_summaries from existing mlop_metrics data.
 * The materialized view only captures new inserts — this script backfills historical data.
 *
 * Usage:
 *   pnpm exec tsx scripts/backfill-metric-summaries.ts
 *
 * Environment: Reads CLICKHOUSE_URL, CLICKHOUSE_USER, CLICKHOUSE_PASSWORD from process.env
 * or falls back to the env module.
 */

import { createClient } from "@clickhouse/client-web";

const ch = createClient({
  url: process.env.CLICKHOUSE_URL ?? "http://localhost:8123",
  username: process.env.CLICKHOUSE_USER ?? "default",
  password: process.env.CLICKHOUSE_PASSWORD ?? "",
});

async function backfill() {
  console.log("Backfilling mlop_metric_summaries from mlop_metrics...");

  const sql = `
    INSERT INTO mlop_metric_summaries
    SELECT
      tenantId,
      projectName,
      runId,
      logName,
      min(value)               AS min_value,
      max(value)               AS max_value,
      sum(value)               AS sum_value,
      toUInt64(count())        AS count_value,
      argMaxState(value, step) AS last_value,
      sum(value * value)       AS sum_sq_value
    FROM mlop_metrics
    GROUP BY tenantId, projectName, runId, logName
  `;

  await ch.query({ query: sql });
  console.log("Backfill complete.");

  // Print row count
  const countResult = await ch.query({
    query: "SELECT count() AS cnt FROM mlop_metric_summaries",
    format: "JSONEachRow",
  });
  const rows = await countResult.json<{ cnt: string }>();
  console.log(`Total rows in mlop_metric_summaries: ${rows[0]?.cnt ?? 0}`);
}

backfill()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Backfill failed:", err);
    process.exit(1);
  });
