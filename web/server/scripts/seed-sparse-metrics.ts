/**
 * Seed sparse metric data for testing the "Skip missing values" chart feature.
 * Uses raw HTTP/SQL calls (no library deps) so it can run from within the Docker
 * backend container without requiring @prisma/client or @clickhouse/client-web.
 *
 * Usage (Docker):
 *   docker compose --env-file .env exec backend node scripts/seed-sparse-metrics.js
 *
 * Or build first:
 *   npx tsx scripts/seed-sparse-metrics.ts  (from host with deps available)
 */

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const DEV_ORG_SLUG = 'dev-org';
const DEV_PROJECT = 'my-ml-project';
const TOTAL_STEPS = 1000;

const PG_URL = process.env.DATABASE_URL || 'postgresql://postgres:nope@db:5432/postgres';
const CH_URL = process.env.CLICKHOUSE_URL || 'http://clickhouse:8123';
const CH_USER = process.env.CLICKHOUSE_USER || 'default';
const CH_PASS = process.env.CLICKHOUSE_PASSWORD || '';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Run a Postgres query via the backend's tRPC/Hono — not available raw.
 *  Instead we'll use the pg module if available, or fall back to psql-like approach. */

// Use native pg module (available in Node 22 via npm)
async function pgQuery(sql: string): Promise<any[]> {
  // Dynamic import to handle missing module gracefully
  const { Client } = await import('pg' as any);
  const client = new Client({ connectionString: PG_URL });
  await client.connect();
  try {
    const res = await client.query(sql);
    return res.rows;
  } finally {
    await client.end();
  }
}

async function chQuery(sql: string): Promise<string> {
  const url = `${CH_URL}/?user=${encodeURIComponent(CH_USER)}&password=${encodeURIComponent(CH_PASS)}`;
  const res = await fetch(url, { method: 'POST', body: sql });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`ClickHouse error: ${res.status} ${text}`);
  }
  return res.text();
}

// ---------------------------------------------------------------------------
// Metric patterns
// ---------------------------------------------------------------------------
interface GapPattern {
  name: string;
  group: string;
  ranges: [number, number][];
  valueFn: (step: number) => number;
}

function makeMetrics(seed: number): GapPattern[] {
  return [
    {
      name: 'sparse/loss_with_gaps',
      group: 'sparse',
      ranges: seed === 0 ? [[0, 200], [501, 800], [901, 1000]] : [[0, 400], [601, 1000]],
      valueFn: (step) => {
        const p = step / TOTAL_STEPS;
        return (seed === 0 ? 2.0 : 1.8) * Math.exp(-(seed === 0 ? 3 : 2.5) * p) + 0.1 + Math.random() * 0.05;
      },
    },
    {
      name: 'sparse/accuracy_with_gaps',
      group: 'sparse',
      ranges: seed === 0 ? [[0, 200], [501, 800], [901, 1000]] : [[0, 400], [601, 1000]],
      valueFn: (step) => {
        const p = step / TOTAL_STEPS;
        return (seed === 0 ? 0.5 : 0.55) + 0.45 * (1 - Math.exp(-4 * p)) + Math.random() * 0.02;
      },
    },
    {
      name: 'sparse/periodic_logging',
      group: 'sparse',
      ranges: (() => {
        const r: [number, number][] = [];
        const offset = seed === 0 ? 0 : 75;
        for (let s = offset; s < TOTAL_STEPS; s += 150) {
          r.push([s, Math.min(s + 49, TOTAL_STEPS)]);
        }
        return r;
      })(),
      valueFn: (step) => {
        const p = step / TOTAL_STEPS;
        return Math.sin(p * Math.PI * 4 + seed * 0.5) * 0.5 + 1.0 + Math.random() * 0.03;
      },
    },
    {
      name: 'sparse/early_and_late_only',
      group: 'sparse',
      ranges: seed === 0 ? [[0, 100], [900, 1000]] : [[300, 700]],
      valueFn: (step) => {
        const p = step / TOTAL_STEPS;
        return 0.8 - 0.6 * p + Math.random() * 0.04;
      },
    },
    {
      name: 'sparse/dense_reference',
      group: 'sparse',
      ranges: [[0, 1000]],
      valueFn: (step) => {
        const p = step / TOTAL_STEPS;
        return (seed === 0 ? 1.5 : 1.3) * Math.exp(-2 * p) + 0.2 + Math.random() * 0.03;
      },
    },
  ];
}

function isInRange(step: number, ranges: [number, number][]): boolean {
  return ranges.some(([a, b]) => step >= a && step <= b);
}

function escapeStr(s: string): string {
  return s.replace(/'/g, "''");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log('Seeding sparse metric data for skip-missing-values testing...\n');

  // 1. Find org & project
  const orgs = await pgQuery(`SELECT id FROM organization WHERE slug = '${DEV_ORG_SLUG}' LIMIT 1`);
  if (orgs.length === 0) { console.error('Dev org not found. Run seed-dev.ts first.'); process.exit(1); }
  const orgId = orgs[0].id;

  const projects = await pgQuery(
    `SELECT id, name, "nextRunNumber" FROM projects WHERE "organizationId" = '${orgId}' AND name = '${DEV_PROJECT}' LIMIT 1`
  );
  if (projects.length === 0) { console.error('Dev project not found.'); process.exit(1); }
  const projectId = projects[0].id;
  let nextRunNumber: number = projects[0].nextRunNumber || 999;

  const users = await pgQuery(
    `SELECT "userId" FROM member WHERE "organizationId" = '${orgId}' AND role = 'OWNER' LIMIT 1`
  );
  if (users.length === 0) { console.error('No owner found.'); process.exit(1); }
  const userId = users[0].userId;

  const apiKeys = await pgQuery(
    `SELECT id FROM api_key WHERE "organizationId" = '${orgId}' LIMIT 1`
  );
  if (apiKeys.length === 0) { console.error('No API key found.'); process.exit(1); }
  const apiKeyId = apiKeys[0].id;

  console.log(`   Org: ${orgId}, Project: ${projectId}, User: ${userId}, ApiKey: ${apiKeyId}`);

  // 2. Create runs
  const runNames = ['sparse-gaps-demo', 'sparse-gaps-comparison'];
  const runIds: { id: string; name: string }[] = [];

  for (const name of runNames) {
    const existing = await pgQuery(
      `SELECT id FROM runs WHERE "projectId" = ${projectId} AND "organizationId" = '${orgId}' AND name = '${name}' LIMIT 1`
    );

    if (existing.length > 0) {
      console.log(`   Run exists: ${name} (id=${existing[0].id})`);
      runIds.push({ id: existing[0].id, name });
    } else {
      // Generate a nanoid-like id
      const id = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
      nextRunNumber++;

      await pgQuery(`
        INSERT INTO runs (name, number, "organizationId", "projectId", "createdById", "creatorApiKeyId", status, tags, config, "systemMetadata", "createdAt", "updatedAt")
        VALUES (
          '${name}', ${nextRunNumber}, '${orgId}', ${projectId}, '${userId}', '${apiKeyId}',
          'COMPLETED',
          ARRAY['sparse-test', 'skip-missing-values'],
          '{"description": "Test run with sparse metric gaps"}'::jsonb,
          '{"hostname": "dev-machine-sparse", "gpu": "A100"}'::jsonb,
          NOW(), NOW()
        )
      `);

      const newRun = await pgQuery(
        `SELECT id FROM runs WHERE "projectId" = ${projectId} AND "organizationId" = '${orgId}' AND name = '${name}' LIMIT 1`
      );
      console.log(`   Created run: ${name} (id=${newRun[0].id})`);
      runIds.push({ id: newRun[0].id, name });
    }
  }

  // Update nextRunNumber
  await pgQuery(`UPDATE projects SET "nextRunNumber" = ${nextRunNumber + 1} WHERE id = ${projectId}`);

  // 3. Register metric names in RunLogs
  for (let i = 0; i < runIds.length; i++) {
    const run = runIds[i];
    const metrics = makeMetrics(i);

    for (const m of metrics) {
      await pgQuery(`
        INSERT INTO "run_logs" ("runId", "logName", "logGroup", "logType")
        VALUES (${run.id}, '${escapeStr(m.name)}', '${escapeStr(m.group)}', 'METRIC')
        ON CONFLICT DO NOTHING
      `);
    }
  }
  console.log('   Registered metric names in RunLogs');

  // 4. Clear any existing ClickHouse data for these runs
  for (const run of runIds) {
    await chQuery(`ALTER TABLE mlop_metrics DELETE WHERE tenantId = '${orgId}' AND runId = ${run.id}`);
    await chQuery(`ALTER TABLE mlop_metric_summaries DELETE WHERE tenantId = '${orgId}' AND runId = ${run.id}`);
  }
  console.log('   Cleared existing ClickHouse data');
  await new Promise((r) => setTimeout(r, 2000));

  // 5. Insert sparse metrics
  let totalInserted = 0;
  const baseTime = Date.now() - TOTAL_STEPS * 1000;

  for (let runIdx = 0; runIdx < runIds.length; runIdx++) {
    const run = runIds[runIdx];
    const metrics = makeMetrics(runIdx);
    const rows: string[] = [];

    for (const metric of metrics) {
      for (let step = 0; step <= TOTAL_STEPS; step++) {
        if (!isInRange(step, metric.ranges)) continue;

        const time = new Date(baseTime + step * 1000)
          .toISOString()
          .replace('T', ' ')
          .replace('Z', '');
        const value = metric.valueFn(step);

        rows.push(
          `('${orgId}','${DEV_PROJECT}',${run.id},'${metric.group}','${metric.name}','${time}',${step},${value})`
        );
      }
    }

    // Insert in chunks
    const CHUNK = 5000;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const chunk = rows.slice(i, i + CHUNK);
      await chQuery(
        `INSERT INTO mlop_metrics (tenantId, projectName, runId, logGroup, logName, time, step, value) VALUES ${chunk.join(',')}`
      );
    }

    totalInserted += rows.length;
    console.log(`   Inserted ${rows.length} datapoints for ${run.name}`);
  }

  // 6. Backfill metric summaries
  console.log('   Backfilling metric summaries...');
  for (const run of runIds) {
    await chQuery(`
      INSERT INTO mlop_metric_summaries
      SELECT tenantId, projectName, runId, logName,
        min(value), max(value), sum(value),
        toUInt64(count()),
        argMaxState(value, step),
        sum(value * value)
      FROM mlop_metrics
      WHERE tenantId = '${orgId}' AND projectName = '${DEV_PROJECT}'
        AND runId = ${run.id}
        AND isFinite(value)
      GROUP BY tenantId, projectName, runId, logName
    `);
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log('Sparse metric data seeded successfully!');
  console.log(`Total datapoints: ${totalInserted}`);
  console.log(`\nTest instructions:`);
  console.log(`  1. Open single run: "sparse-gaps-demo"`);
  console.log(`     - Look at the "sparse" metric group`);
  console.log(`     - Toggle "Skip missing values" in Settings (gear icon)`);
  console.log(`     - "dense_reference" has no gaps (control)`);
  console.log(`     - "loss_with_gaps" has 2 gaps: steps 201-500 and 801-900`);
  console.log(`     - "periodic_logging" logs in bursts of 50 every 150 steps`);
  console.log(`     - "early_and_late_only" only has first & last 100 steps`);
  console.log(`  2. Compare both runs in project view`);
  console.log(`     - Select "sparse-gaps-demo" + "sparse-gaps-comparison"`);
  console.log(`     - Gaps are in different positions per run`);
  console.log(`     - Toggle "Skip missing values" to see lines break`);
  console.log(`${'='.repeat(60)}\n`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Error:', error);
    process.exit(1);
  });
