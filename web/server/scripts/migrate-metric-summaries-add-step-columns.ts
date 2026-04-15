/**
 * One-shot migration: add min_step / max_step columns to mlop_metric_summaries
 * and rebuild the materialized view + backfill so they're populated.
 *
 * Run this on production ClickHouse BEFORE deploying the backend code from the
 * perf/chart-query-optimizations PR. The new backend's bounds CTE reads these
 * columns; if you deploy the code first, chart queries will error with
 * "Missing columns: min_step max_step".
 *
 * Safe to re-run: ALTER uses IF NOT EXISTS, DROP VIEW uses IF EXISTS, and
 * TRUNCATE + backfill always produces the same deterministic result.
 *
 * Usage:
 *   cd web/server
 *   CLICKHOUSE_URL=... CLICKHOUSE_USER=... CLICKHOUSE_PASSWORD=... \
 *     pnpm exec tsx scripts/migrate-metric-summaries-add-step-columns.ts
 */

import { createClient } from "@clickhouse/client-web";

const ch = createClient({
  url: process.env.CLICKHOUSE_URL ?? "http://localhost:8123",
  username: process.env.CLICKHOUSE_USER ?? "default",
  password: process.env.CLICKHOUSE_PASSWORD ?? "",
});

async function countRows(table: string): Promise<number> {
  const r = await ch.query({
    query: `SELECT count() AS cnt FROM ${table}`,
    format: "JSONEachRow",
  });
  const rows = (await r.json()) as { cnt: string }[];
  return Number(rows[0]?.cnt ?? 0);
}

async function step(label: string, fn: () => Promise<void>) {
  const t0 = Date.now();
  process.stdout.write(`→ ${label} ... `);
  try {
    await fn();
    console.log(`done (${Date.now() - t0}ms)`);
  } catch (err) {
    console.log("FAILED");
    throw err;
  }
}

async function main() {
  console.log("Migrating mlop_metric_summaries: add min_step / max_step columns\n");

  const rawRows = await countRows("mlop_metrics");
  console.log(`mlop_metrics:          ${rawRows.toLocaleString()} rows`);
  const summariesBefore = await countRows("mlop_metric_summaries");
  console.log(`mlop_metric_summaries: ${summariesBefore.toLocaleString()} rows (before)\n`);

  // Step 1: add the new columns. Safe to re-run — ADD COLUMN IF NOT EXISTS is
  // a no-op if the columns already exist.
  await step(
    "ALTER TABLE: add min_step + max_step columns",
    async () => {
      await ch.query({
        query: `
          ALTER TABLE mlop_metric_summaries
            ADD COLUMN IF NOT EXISTS min_step SimpleAggregateFunction(min, UInt64) DEFAULT 0,
            ADD COLUMN IF NOT EXISTS max_step SimpleAggregateFunction(max, UInt64) DEFAULT 0
        `,
      });
    },
  );

  // Step 2: drop the old materialized view. Its SELECT doesn't mention the
  // new columns, so any ingest it processes between now and the new MV
  // creation would leave those columns at their default (0). That's fine —
  // we TRUNCATE + backfill next, which rebuilds all rows from the raw table.
  await step(
    "DROP old mlop_metric_summaries_mv",
    async () => {
      await ch.query({ query: `DROP VIEW IF EXISTS mlop_metric_summaries_mv` });
    },
  );

  // Step 3: create the new MV with min(step) / max(step) in its SELECT. From
  // this point on, every row inserted into mlop_metrics automatically flows
  // into mlop_metric_summaries with the new columns populated — no ongoing
  // maintenance required.
  await step(
    "CREATE new mlop_metric_summaries_mv with min_step / max_step",
    async () => {
      await ch.query({
        query: `
          CREATE MATERIALIZED VIEW mlop_metric_summaries_mv
          TO mlop_metric_summaries
          AS SELECT
              tenantId,
              projectName,
              runId,
              logName,
              min(value)              AS min_value,
              max(value)              AS max_value,
              sum(value)              AS sum_value,
              toUInt64(count())       AS count_value,
              argMaxState(value, step) AS last_value,
              sum(value * value)      AS sum_sq_value,
              min(step)               AS min_step,
              max(step)               AS max_step
          FROM mlop_metrics
          WHERE isFinite(value)
          GROUP BY tenantId, projectName, runId, logName
        `,
      });
    },
  );

  // Step 4: wipe existing summaries rows. AggregatingMergeTree's sum/count
  // aggregates would double-count if we re-ran the backfill INSERT against
  // existing rows (the merge combines sums additively). Truncating guarantees
  // a clean rebuild. This is the only "destructive" step, but it's safe
  // because step 5 rebuilds everything from mlop_metrics below.
  await step(
    "TRUNCATE mlop_metric_summaries (clean slate for backfill)",
    async () => {
      await ch.query({ query: `TRUNCATE TABLE mlop_metric_summaries` });
    },
  );

  // Step 5: rebuild all summary rows by re-aggregating mlop_metrics. Matches
  // the MV's SELECT exactly so the backfill produces the same rows the MV
  // would have produced had it always existed.
  await step(
    "Backfill mlop_metric_summaries from mlop_metrics",
    async () => {
      await ch.query({
        query: `
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
            sum(value * value)       AS sum_sq_value,
            min(step)                AS min_step,
            max(step)                AS max_step
          FROM mlop_metrics
          WHERE isFinite(value)
          GROUP BY tenantId, projectName, runId, logName
        `,
      });
    },
  );

  const summariesAfter = await countRows("mlop_metric_summaries");
  console.log(`\nmlop_metric_summaries: ${summariesAfter.toLocaleString()} rows (after)`);
  console.log("\nMigration complete. Safe to deploy the backend code now.");
}

main()
  .then(() => {
    ch.close();
    process.exit(0);
  })
  .catch((err) => {
    console.error("\nMigration failed:", err);
    ch.close();
    process.exit(1);
  });
