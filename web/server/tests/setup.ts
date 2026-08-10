/**
 * Test Database Setup
 *
 * This script bootstraps the test database with:
 * - Test user
 * - Test organization
 * - Test API key
 * - Test project
 *
 * Run before smoke tests: pnpm test:setup
 */

import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';
import { nanoid } from 'nanoid';
import zlib from 'zlib';
import { createClient, type ClickHouseClient } from '@clickhouse/client-web';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { extractAndUpsertColumnKeys } from '../lib/extract-column-keys';

// Bulk run seeding configuration for server-side search testing
// Frontend loads 150 runs at a time, so we need >150 to expose pagination issues
const SEARCH_TEST_RUN_COUNT = 160;
const METRICS_PER_RUN = 50;
const DATAPOINTS_PER_METRIC = 1000;

const prisma = new PrismaClient();

interface TestData {
  userId: string;
  organizationId: string;
  organizationSlug: string;
  organization2Id: string;
  organization2Slug: string;
  apiKey: string;
  apiKeyId: string;
  projectName: string;
  projectId: string;
}

async function hashApiKey(key: string): Promise<string> {
  return crypto.createHash('sha256').update(key).digest('hex');
}

function createPNGChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuffer = Buffer.from(type, 'ascii');
  const crcData = Buffer.concat([typeBuffer, data]);
  let crc = 0xffffffff;
  for (let i = 0; i < crcData.length; i++) {
    crc ^= crcData[i];
    for (let k = 0; k < 8; k++) {
      crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    }
  }
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE((crc ^ 0xffffffff) >>> 0, 0);
  return Buffer.concat([length, typeBuffer, data, crcBuf]);
}

function createSimplePNG(
  width: number,
  height: number,
  r: number,
  g: number,
  b: number,
): Buffer {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8;
  ihdrData[9] = 2; // 8-bit RGB
  const ihdrChunk = createPNGChunk('IHDR', ihdrData);
  const rawData: number[] = [];
  for (let y = 0; y < height; y++) {
    rawData.push(0); // filter: none
    for (let x = 0; x < width; x++) {
      rawData.push(r, g, b);
    }
  }
  const idatChunk = createPNGChunk('IDAT', zlib.deflateSync(Buffer.from(rawData)));
  const iendChunk = createPNGChunk('IEND', Buffer.alloc(0));
  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

/**
 * A segmentation mask PNG: each pixel's value IS a class id, not a colour.
 *
 * `annotated-image.tsx` reads the id out of the RED channel (as wandb's own
 * reader does), so red is the only channel that matters — but all three are
 * written to the same value so the file reads as plain greyscale if anything
 * ever opens it directly, and so a viewer that guessed a different channel
 * would still get the right answer.
 *
 * 8-bit RGB, so ids are 0-255 — exactly the range `buildLayerLut` covers.
 * `classAt` is evaluated per pixel, which is fine at fixture sizes.
 */
function createClassMaskPNG(
  width: number,
  height: number,
  classAt: (x: number, y: number) => number,
): Buffer {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8;
  ihdrData[9] = 2; // 8-bit RGB
  const ihdrChunk = createPNGChunk('IHDR', ihdrData);
  const rawData: number[] = [];
  for (let y = 0; y < height; y++) {
    rawData.push(0); // filter: none
    for (let x = 0; x < width; x++) {
      const id = classAt(x, y) & 0xff;
      rawData.push(id, id, id);
    }
  }
  const idatChunk = createPNGChunk('IDAT', zlib.deflateSync(Buffer.from(rawData)));
  const iendChunk = createPNGChunk('IEND', Buffer.alloc(0));
  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

/**
 * Trigger an unscheduled refresh of mlop_metric_summaries_v2_refresh_mv and
 * wait for it to complete.
 *
 * The refreshable MV recomputes summaries every 5 min in production. Tests
 * can't wait that long — manually triggering forces it to run now so the
 * just-seeded fixture data shows up in mlop_metric_summaries_v2 before tests
 * read it.
 *
 * The mirror MV (mlop_metrics_v2_mv) propagates mlop_metrics → mlop_metrics_v2
 * synchronously on each insert, so by the time we trigger the refresh, v2 has
 * everything the seeders wrote. The refreshable MV reads from v2 FINAL.
 */
async function refreshMetricSummariesAndWait(ch: ClickHouseClient): Promise<void> {
  await ch.command({
    query: 'SYSTEM REFRESH VIEW mlop_metric_summaries_v2_refresh_mv',
  });
  // Poll until status leaves "Running". Refresh on test-scale data is ~1s.
  // Cap at 15s; if it hits the timeout something is genuinely wrong.
  for (let attempt = 0; attempt < 60; attempt++) {
    const r = await ch.query({
      query: `SELECT status FROM system.view_refreshes WHERE view = 'mlop_metric_summaries_v2_refresh_mv'`,
      format: 'JSONEachRow',
    });
    const rows = (await r.json()) as Array<{ status: string }>;
    if (rows[0]?.status && rows[0].status !== 'Running') return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('mlop_metric_summaries_v2_refresh_mv refresh timed out after 15s');
}

/**
 * Seeds ClickHouse with metric datapoints for bulk test runs.
 * Creates realistic training metrics (loss curves with exponential decay).
 */
async function seedClickHouseMetrics(
  runs: { id: bigint; name: string; createdAt: Date }[],
  tenantId: string,
  projectName: string,
  metricsPerRun: number,
  datapointsPerMetric: number,
  /**
   * Overrides the generated `train/metric_NN` names, one per metric. Fixtures
   * whose `run_logs` registry names a specific metric must pass it here: the
   * metric list comes from the registry but the chart's data comes from
   * ClickHouse, so a name that appears in only one of the two lists a metric
   * that can never draw.
   */
  metricNames?: string[],
): Promise<void> {
  const clickhouseUrl = process.env.CLICKHOUSE_URL;
  const clickhouseUser = process.env.CLICKHOUSE_USER || 'default';
  const clickhousePassword = process.env.CLICKHOUSE_PASSWORD || '';

  if (!clickhouseUrl) {
    console.log('   ⚠ CLICKHOUSE_URL not set, skipping ClickHouse seeding');
    return;
  }

  const clickhouse = createClient({
    url: clickhouseUrl,
    username: clickhouseUser,
    password: clickhousePassword,
  });

  const totalRows = runs.length * metricsPerRun * datapointsPerMetric;
  console.log(`   📊 Seeding ClickHouse with ${totalRows.toLocaleString()} metric datapoints...`);

  // Batch insert for efficiency (insert in chunks to avoid memory issues)
  const BATCH_SIZE = 50000;
  let batch: Record<string, unknown>[] = [];
  let insertedCount = 0;

  for (const run of runs) {
    const baseTime = run.createdAt.getTime();
    for (let m = 0; m < metricsPerRun; m++) {
      const metricName =
        metricNames?.[m] ?? `train/metric_${String(m).padStart(2, '0')}`;
      // Group by the name's prefix, matching how the SDK emits grouped metrics.
      const logGroup = metricName.includes('/') ? metricName.split('/')[0] : 'train';

      for (let step = 0; step < datapointsPerMetric; step++) {
        batch.push({
          tenantId,
          projectName,
          runId: Number(run.id),
          logGroup,
          logName: metricName,
          time: new Date(baseTime + step * 1000).toISOString().replace('T', ' ').replace('Z', ''),
          step,
          // Realistic decaying loss curve with some noise
          value: Math.random() * 0.1 + Math.exp(-step / 200) * 2,
        });

        if (batch.length >= BATCH_SIZE) {
          await clickhouse.insert({
            table: 'mlop_metrics',
            values: batch,
            format: 'JSONEachRow',
          });
          insertedCount += batch.length;
          process.stdout.write(`\r   📊 Inserted ${insertedCount.toLocaleString()} / ${totalRows.toLocaleString()} rows...`);
          batch = [];
        }
      }
    }
  }

  // Flush remaining batch
  if (batch.length > 0) {
    await clickhouse.insert({
      table: 'mlop_metrics',
      values: batch,
      format: 'JSONEachRow',
    });
    insertedCount += batch.length;
  }

  console.log(`\r   ✓ Seeded ClickHouse with ${insertedCount.toLocaleString()} metric datapoints`);

  // mlop_metric_summaries population is handled by a single SYSTEM REFRESH
  // VIEW call near the end of setupTestData (after all fixtures are seeded).

  await clickhouse.close();
}

/**
 * Seeds NaN/Inf metric values for the nan-inf-metrics run via raw SQL.
 * JSON.stringify converts NaN/Infinity to null, so we must use raw SQL
 * with ClickHouse's native nan/inf literals.
 *
 * Layout (14 train/* metrics):
 * - Indices 0-1:  realistic curves (loss, accuracy) with ~3% NaN sprinkled
 * - Indices 2-3:  realistic curves (lr, grad_norm) with ~2% +Inf spikes
 * - Index 4:      realistic curve (epoch_time) with ~1% -Inf
 * - Index 5:      realistic curve (precision) with mixed ~2% NaN and ~2% Inf
 * - Indices 6-9:  all-finite control metrics
 * - Indices 10-11: all-NaN edge-case metrics
 * - Indices 12-13: all-finite control metrics
 */
async function seedNanInfMetrics(
  runId: bigint,
  runCreatedAt: Date,
  tenantId: string,
  projectName: string,
): Promise<void> {
  const clickhouseUrl = process.env.CLICKHOUSE_URL;
  const clickhouseUser = process.env.CLICKHOUSE_USER || 'default';
  const clickhousePassword = process.env.CLICKHOUSE_PASSWORD || '';

  if (!clickhouseUrl) {
    console.log('   ⚠ CLICKHOUSE_URL not set, skipping NaN/Inf seeding');
    return;
  }

  const clickhouse = createClient({
    url: clickhouseUrl,
    username: clickhouseUser,
    password: clickhousePassword,
  });

  const metricNames = [
    'train/loss', 'train/accuracy', 'train/lr', 'train/grad_norm',
    'train/epoch_time', 'train/precision', 'train/recall', 'train/f1',
    'train/auc', 'train/perplexity', 'train/gpu_util', 'train/memory_used',
    'train/throughput', 'train/latency',
  ];
  const STEPS = 200;  // 200 steps × 14 metrics = 2,800 rows (enough for NaN/Inf marker tests)
  const baseTime = runCreatedAt.getTime();
  const rows: string[] = [];

  for (let m = 0; m < metricNames.length; m++) {
    const metricName = metricNames[m];
    for (let step = 0; step < STEPS; step++) {
      const time = new Date(baseTime + step * 1000)
        .toISOString()
        .replace('T', ' ')
        .replace('Z', '');

      let value: string;
      const rand = Math.random();

      if (m === 0) {
        // train/loss: exponential decay with ~3% NaN sprinkled
        if (rand < 0.03) {
          value = 'nan';
        } else {
          value = String(2.0 * Math.exp(-step / 600) + Math.random() * 0.1);
        }
      } else if (m === 1) {
        // train/accuracy: sigmoid growth with ~3% NaN sprinkled
        if (rand < 0.03) {
          value = 'nan';
        } else {
          value = String(1.0 - Math.exp(-step / 500) + Math.random() * 0.05);
        }
      } else if (m === 2) {
        // train/lr: linear decay with ~2% +Inf spikes (gradient explosions)
        if (rand < 0.02) {
          value = 'inf';
        } else {
          value = String(0.001 * (1 - step / STEPS));
        }
      } else if (m === 3) {
        // train/grad_norm: noisy with ~2% +Inf spikes
        if (rand < 0.02) {
          value = 'inf';
        } else {
          value = String(Math.random() * 2 + 0.5);
        }
      } else if (m === 4) {
        // train/epoch_time: ~10-20 range with ~1% -Inf
        if (rand < 0.01) {
          value = '-inf';
        } else {
          value = String(10 + Math.random() * 10);
        }
      } else if (m === 5) {
        // train/precision: sigmoid growth with mixed ~2% NaN and ~2% Inf
        if (rand < 0.02) {
          value = 'nan';
        } else if (rand < 0.04) {
          value = 'inf';
        } else {
          value = String(0.5 + 0.4 * (1 - Math.exp(-step / 800)) + Math.random() * 0.03);
        }
      } else if (m === 10 || m === 11) {
        // All-NaN edge case metrics (gpu_util, memory_used)
        value = 'nan';
      } else {
        // All-finite control metrics (recall, f1, auc, perplexity, throughput, latency)
        value = String(Math.random() * 10);
      }

      rows.push(
        `('${tenantId}','${projectName}',${Number(runId)},'train','${metricName}','${time}',${step},${value})`
      );
    }
  }

  console.log(`   📊 Inserting ${rows.length} NaN/Inf metric rows...`);

  const CHUNK = 5000;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    await clickhouse.command({
      query: `INSERT INTO mlop_metrics (tenantId, projectName, runId, logGroup, logName, time, step, value)
              VALUES ${chunk.join(',')}`,
    });
  }

  await clickhouse.close();
  console.log(`   ✓ Inserted ${rows.length} NaN/Inf metric rows`);
}

/**
 * Seeds deeply-nested gradient-norm metrics for testing the dynamic-section
 * grouping feature. Mirrors what real per-layer training runs produce:
 *
 *   gradients/norms/<layer-path>/{min, max, mean, std}
 *
 * 5 layer prefixes × 4 stat suffixes = 20 metrics per run. Cheap to seed
 * (200 datapoints/metric → 4k rows per run), reuses the same backfill
 * pattern as seedClickHouseMetrics.
 */
const NESTED_GRAD_NORM_LAYERS = [
  'model.encoder.layer_0',
  'model.encoder.layer_1',
  'model.encoder.layer_2',
  'model.decoder.attention',
  'model.decoder.mlp',
];
const NESTED_GRAD_NORM_STATS = ['min', 'max', 'mean', 'std'];

async function seedNestedGradNormMetrics(
  runs: Array<{ id: bigint; name: string; createdAt: Date }>,
  tenantId: string,
  projectName: string,
): Promise<void> {
  const clickhouseUrl = process.env.CLICKHOUSE_URL;
  const clickhouseUser = process.env.CLICKHOUSE_USER || 'default';
  const clickhousePassword = process.env.CLICKHOUSE_PASSWORD || '';
  if (!clickhouseUrl) {
    console.log('   ⚠ CLICKHOUSE_URL not set, skipping nested grad-norm seeding');
    return;
  }

  const clickhouse = createClient({
    url: clickhouseUrl,
    username: clickhouseUser,
    password: clickhousePassword,
  });

  const STEPS = 200;
  const rows: Record<string, unknown>[] = [];

  for (const run of runs) {
    const baseTime = run.createdAt.getTime();
    for (let li = 0; li < NESTED_GRAD_NORM_LAYERS.length; li++) {
      const layer = NESTED_GRAD_NORM_LAYERS[li];
      // Per-layer scale so different layers have visibly different magnitudes
      const layerScale = 0.5 + 0.5 * Math.abs(Math.cos(li * 0.7));
      for (const stat of NESTED_GRAD_NORM_STATS) {
        const logName = `gradients/norms/${layer}/${stat}`;
        for (let step = 0; step < STEPS; step++) {
          const decay = Math.exp(-2 * (step / STEPS));
          const noise = (Math.random() - 0.5) * 0.02;
          const base = 0.05 * layerScale * decay + 0.005;
          let value: number;
          switch (stat) {
            case 'min':  value = Math.max(0, base * 0.05 + noise * 0.2); break;
            case 'max':  value = base * 4.0 + Math.abs(noise) * 2.0; break;
            case 'mean': value = base + noise; break;
            case 'std':  value = base * 0.6 + Math.abs(noise); break;
            default:     value = base;
          }
          rows.push({
            tenantId,
            projectName,
            runId: Number(run.id),
            logGroup: 'gradients/norms',
            logName,
            time: new Date(baseTime + step * 1000).toISOString().replace('T', ' ').replace('Z', ''),
            step,
            value,
          });
        }
      }
    }
  }

  // Batch insert
  const BATCH = 50000;
  for (let i = 0; i < rows.length; i += BATCH) {
    await clickhouse.insert({
      table: 'mlop_metrics',
      values: rows.slice(i, i + BATCH),
      format: 'JSONEachRow',
    });
  }

  // Backfill mlop_metric_summaries for the new metrics so charts have stats.
  // Scoped to (tenantId, projectName, gradients/norms/% logName)
  // so we don't redo work for the train/metric_NN summaries.
  await clickhouse.command({
    query: `
      INSERT INTO mlop_metric_summaries
      SELECT
        tenantId, projectName, runId, logName,
        min(value)               AS min_value,
        max(value)               AS max_value,
        sum(value)               AS sum_value,
        toUInt64(count())        AS count_value,
        argMaxState(value, step) AS last_value,
        sum(value * value)       AS sum_sq_value,
        min(step)                AS min_step,
        max(step)                AS max_step
      FROM mlop_metrics
      WHERE tenantId = {tenantId: String}
        AND projectName = {projectName: String}
        AND logName LIKE 'gradients/norms/%'
        AND isFinite(value)
      GROUP BY tenantId, projectName, runId, logName
    `,
    query_params: { tenantId, projectName },
  });

  await clickhouse.close();
  console.log(`   ✓ Seeded ${rows.length} nested grad-norm rows across ${runs.length} runs`);
}

/**
 * Seeds blah-eval metrics with TWO independently-varying path segments
 * for testing regex-with-multiple-capture-groups prefix grouping:
 *
 *   validation/blah/<horizon>/<variant>/<metric>
 *
 * 3 horizons × 2 variants × 3 metrics = 18 metrics per run. Designed so:
 *   - Regex `validation/blah/(.*?)/(original|smoothed)/` produces 6
 *     buckets keyed on (horizon, variant), each combining the 3 metrics.
 *   - Regex `validation/blah/(.*?)/original/` produces 3 buckets
 *     keyed on horizon, each combining the 3 original-variant metrics
 *     (smoothed metrics fall through as standalone widgets).
 *
 * Prefix `validation/blah/` deliberately avoids the substring "train" so
 * existing IR-C tests' default "train" metric filter doesn't pick it up.
 * (Note: "trainy" — our earlier name — contained "train" and broke that.)
 */
const BLAH_HORIZONS = ['5T', 'H', 'D'];
const BLAH_VARIANTS = ['original', 'smoothed'];
const BLAH_METRICS = ['CRPS', 'MASE', 'MAPE'];

async function seedBlahMetrics(
  runs: Array<{ id: bigint; name: string; createdAt: Date }>,
  tenantId: string,
  projectName: string,
): Promise<void> {
  const clickhouseUrl = process.env.CLICKHOUSE_URL;
  const clickhouseUser = process.env.CLICKHOUSE_USER || 'default';
  const clickhousePassword = process.env.CLICKHOUSE_PASSWORD || '';
  if (!clickhouseUrl) {
    console.log('   ⚠ CLICKHOUSE_URL not set, skipping blah seeding');
    return;
  }

  const clickhouse = createClient({
    url: clickhouseUrl,
    username: clickhouseUser,
    password: clickhousePassword,
  });

  const STEPS = 200;
  const rows: Record<string, unknown>[] = [];

  for (const run of runs) {
    const baseTime = run.createdAt.getTime();
    let curveIdx = 0;
    for (const horizon of BLAH_HORIZONS) {
      for (const variant of BLAH_VARIANTS) {
        for (const metric of BLAH_METRICS) {
          const logName = `validation/blah/${horizon}/${variant}/${metric}`;
          // Each (horizon, variant, metric) gets a slightly different curve so
          // visual debugging in the browser distinguishes series within a bucket.
          const curveSeed = curveIdx++;
          for (let step = 0; step < STEPS; step++) {
            const p = step / STEPS;
            const startMag = 1.0 + (curveSeed % 5) * 0.3;
            const baseFloor = 0.05 + (curveSeed % 4) * 0.02;
            const noise = (Math.random() - 0.5) * 0.04;
            const value = startMag * Math.exp(-2.5 * p) + baseFloor + noise;
            rows.push({
              tenantId,
              projectName,
              runId: Number(run.id),
              logGroup: 'validation/blah',
              logName,
              time: new Date(baseTime + step * 1000).toISOString().replace('T', ' ').replace('Z', ''),
              step,
              value,
            });
          }
        }
      }
    }
  }

  const BATCH = 50000;
  for (let i = 0; i < rows.length; i += BATCH) {
    await clickhouse.insert({
      table: 'mlop_metrics',
      values: rows.slice(i, i + BATCH),
      format: 'JSONEachRow',
    });
  }

  await clickhouse.command({
    query: `
      INSERT INTO mlop_metric_summaries
      SELECT
        tenantId, projectName, runId, logName,
        min(value)               AS min_value,
        max(value)               AS max_value,
        sum(value)               AS sum_value,
        toUInt64(count())        AS count_value,
        argMaxState(value, step) AS last_value,
        sum(value * value)       AS sum_sq_value,
        min(step)                AS min_step,
        max(step)                AS max_step
      FROM mlop_metrics
      WHERE tenantId = {tenantId: String}
        AND projectName = {projectName: String}
        AND logName LIKE 'validation/blah/%'
        AND isFinite(value)
      GROUP BY tenantId, projectName, runId, logName
    `,
    query_params: { tenantId, projectName },
  });

  await clickhouse.close();
  console.log(`   ✓ Seeded ${rows.length} blah eval rows across ${runs.length} runs`);
}

interface OrgSetupResult {
  org: { id: string; name: string; slug: string; createdAt: Date };
}

/**
 * Creates or retrieves a test organization with membership and subscription.
 * Reduces code duplication for org setup.
 */
async function ensureTestOrg(
  userId: string,
  orgSlug: string,
  orgName: string,
  stripeIdSuffix: string = ''
): Promise<OrgSetupResult> {
  let org = await prisma.organization.findUnique({
    where: { slug: orgSlug },
  });

  if (!org) {
    org = await prisma.organization.create({
      data: {
        id: nanoid(),
        name: orgName,
        slug: orgSlug,
        createdAt: new Date(),
        members: {
          create: {
            id: nanoid(),
            userId: userId,
            role: 'OWNER',
            createdAt: new Date(),
          },
        },
      },
    });
    console.log(`   ✓ Created organization: ${org.name} (slug: ${org.slug})`);
  } else {
    console.log(`   ✓ Organization already exists: ${org.name} (slug: ${org.slug})`);

    // Ensure user is a member
    const membership = await prisma.member.findFirst({
      where: {
        userId: userId,
        organizationId: org.id,
      },
    });

    if (!membership) {
      await prisma.member.create({
        data: {
          id: nanoid(),
          userId: userId,
          organizationId: org.id,
          role: 'OWNER',
          createdAt: new Date(),
        },
      });
      console.log(`   ✓ Added user as OWNER`);
    }
  }

  // Ensure organization has a subscription with usage limits
  const subscription = await prisma.organizationSubscription.findUnique({
    where: { organizationId: org.id },
  });

  if (!subscription) {
    await prisma.organizationSubscription.create({
      data: {
        organizationId: org.id,
        stripeCustomerId: `cus_test_smoke${stripeIdSuffix}_` + org.id.substring(0, 8),
        stripeSubscriptionId: `sub_test_smoke${stripeIdSuffix}_` + org.id.substring(0, 8),
        plan: 'PRO',
        maxMembers: 10,
        usageLimits: {
          dataUsageGB: 100,
          trainingHoursPerMonth: 750,
        },
      },
    });
    console.log(`   ✓ Created organization subscription with usage limits`);
  }

  return { org };
}

// ───────────────────────────────────────────────────────────────────────────
// Native rich-media / rich-data fixtures (setup step 5j).
//
// Everything in the NM_* block below is the shape the pluto SDK itself
// produces — `pluto.log`, `pluto.Image(boxes=..., masks=...)`, `pluto.Table`,
// `pluto.Html`. These are hand-written, and deliberately cover the cases the
// captured wandb exports in the WM_* block below do NOT reach: fractional box
// coordinates (every migrated box carries `domain: "pixel"`), a mask layer
// that actually declares `class_labels` (no exported one does), and a mask
// holding a class id absent from those labels.
//
// Values are exact and unambiguous — round fractions, small integers,
// distinct strings — so an E2E assertion can name a number, not a tolerance.
// ───────────────────────────────────────────────────────────────────────────

/** Project holding every native media/data fixture. */
const NM_PROJECT = 'native-media-test';

/** Edge of every fixture image and mask, in pixels. */
const NM_IMAGE_SIZE = 64;

const NM_SEG_LOG = 'media/segmentation';
const NM_CAPTION_LOG = 'media/captioned';

/**
 * Class ids in the step-0 mask of `nm-annotated-1`, by quadrant.
 *
 *   top-left  = 1 (labelled "cat")   top-right    = 2 (labelled "dog")
 *   bottom-left = 9 (NOT labelled)   bottom-right = 0 (NOT labelled)
 *
 * The two unlabelled quadrants are the point: `labelledClassIds` builds the
 * tint LUT from `class_labels` alone, so ids missing from it get alpha 0 and
 * the photo shows through. 9 and 0 cover both halves of that rule — an
 * ordinary unlabelled class, and the id people assume is special-cased as
 * "background" but is not.
 */
const NM_MASK_STEP0 = (x: number, y: number): number =>
  y < NM_IMAGE_SIZE / 2 ? (x < NM_IMAGE_SIZE / 2 ? 1 : 2) : x < NM_IMAGE_SIZE / 2 ? 9 : 0;

/**
 * Class ids in the step-2 mask of `nm-annotated-1`: left half 0, right half 1.
 *
 * Its layer DOES label 0, so both halves tint — the converse of the step-0
 * mask, and the reason there is no "id 0 means background" shortcut anywhere.
 */
const NM_MASK_STEP2 = (x: number): number => (x < NM_IMAGE_SIZE / 2 ? 0 : 1);

/**
 * Class ids in `nm-annotated-2`'s mask — top-left quadrant 3, rest 0.
 *
 * Deliberately shares its FILENAME with run 1's step-0 mask while holding
 * different ids and different labels. The all-runs grid resolves masks by
 * file name, so a lookup that is not scoped to its own run silently draws run
 * 1's cat/dog quadrants here instead of run 2's single "tree" corner.
 */
const NM_MASK_RUN2 = (x: number, y: number): number =>
  x < NM_IMAGE_SIZE / 2 && y < NM_IMAGE_SIZE / 2 ? 3 : 0;

/**
 * Step 0 of `nm-annotated-1` — the full-fat annotation: two box layers and a
 * mask layer, so `layerNames()` is exactly
 * ["ground_truth", "predictions", "segmentation"].
 *
 * `ground_truth` is fractional (no `domain`), which is the default and what
 * most data looks like. `predictions` mixes one PIXEL-domain box in with two
 * fractional ones, because that mix is the silent-failure trap: 8..24 read as
 * fractions lands 8 image-widths off-canvas and simply vanishes, with no
 * error anywhere. Both interpretations of the same box therefore have to be
 * on screen at once for a test to catch a regression in `resolveBox`.
 */
const NM_SEG_ANNOTATIONS_STEP0 = {
  boxes: {
    ground_truth: {
      box_data: [
        {
          position: { minX: 0.1, minY: 0.1, maxX: 0.4, maxY: 0.4 },
          class_id: 1,
          box_caption: 'cat',
        },
        {
          position: { minX: 0.55, minY: 0.55, maxX: 0.9, maxY: 0.9 },
          class_id: 2,
          box_caption: 'dog',
        },
      ],
      class_labels: { '1': 'cat', '2': 'dog' },
    },
    predictions: {
      box_data: [
        {
          position: { minX: 8, minY: 8, maxX: 24, maxY: 24 },
          domain: 'pixel',
          class_id: 1,
          box_caption: 'cat 0.91',
          scores: { confidence: 0.91 },
        },
        {
          position: { minX: 0.5, minY: 0.5, maxX: 0.95, maxY: 0.95 },
          class_id: 2,
          box_caption: 'dog 0.77',
          scores: { confidence: 0.77 },
        },
        {
          position: { minX: 0.05, minY: 0.6, maxX: 0.3, maxY: 0.95 },
          class_id: 3,
          box_caption: 'car 0.42',
          scores: { confidence: 0.42 },
        },
      ],
      class_labels: { '1': 'cat', '2': 'dog', '3': 'car' },
    },
  },
  masks: {
    segmentation: {
      fileName: 'seg_step_0_mask.png',
      class_labels: { '1': 'cat', '2': 'dog' },
    },
  },
};

/** Step 2 — mask only, one layer, and the layer labels class 0. */
const NM_SEG_ANNOTATIONS_STEP2 = {
  masks: {
    segmentation: {
      fileName: 'seg_step_2_mask.png',
      class_labels: { '0': 'background', '1': 'cat' },
    },
  },
};

/**
 * Step 3 — boxes only, one layer, one box, pixel domain covering the whole
 * frame. No mask, so this is the overlay path with no canvas involved at all.
 */
const NM_SEG_ANNOTATIONS_STEP3 = {
  boxes: {
    predictions: {
      box_data: [
        {
          position: { minX: 0, minY: 0, maxX: NM_IMAGE_SIZE, maxY: NM_IMAGE_SIZE },
          domain: 'pixel',
          class_id: 5,
          box_caption: 'full frame',
        },
      ],
      class_labels: { '5': 'frame' },
    },
  },
};

/** `nm-annotated-2`'s only annotated step: one box, one mask, two layers. */
const NM_SEG_ANNOTATIONS_RUN2 = {
  boxes: {
    predictions: {
      box_data: [
        {
          position: { minX: 0.2, minY: 0.2, maxX: 0.6, maxY: 0.6 },
          class_id: 3,
          box_caption: 'tree 0.65',
          scores: { confidence: 0.65 },
        },
      ],
      class_labels: { '3': 'tree' },
    },
  },
  masks: {
    segmentation: {
      fileName: 'seg_step_0_mask.png',
      class_labels: { '3': 'tree' },
    },
  },
};

/**
 * Multi-sample media at one step, with the file names in the REVERSE of the
 * logged order.
 *
 * `queryRunFiles` orders by `(step, sampleIndex, fileName)`, so the only way
 * this list can come back z, y, x is if `sampleIndex` is doing the work — a
 * fileName sort would produce exactly the opposite.
 */
const NM_CAPTION_SAMPLES = [
  { sampleIndex: 0, fileName: 'cap_z.png', caption: 'sample zero' },
  { sampleIndex: 1, fileName: 'cap_y.png', caption: 'sample one' },
  { sampleIndex: 2, fileName: 'cap_x.png', caption: 'sample two' },
];

/**
 * Files that arrive as plain `.json` and can only be told apart by content.
 *
 * The names are UUIDs on purpose. `detectMediaJson` sniffs the parsed body,
 * and a fixture named `plotly.json` would let a filename-based shortcut pass
 * the test — which is precisely the bug the sniffing replaced.
 */
const NM_PLOTLY_FILE = '4f8a1c62-0d3b-4a91-9f2e-7c5b1d0e6a34.json';
const NM_MPL_FILE = '9b2d7e14-5a63-4c08-8e7f-2d91a6c3b05f.json';
const NM_CLOUD_FILE = 'c1e05a37-6b48-4d2a-b93c-8f4e7a205d61.json';
const NM_CLOUD_RGB_FILE = 'a7d3f019-8c26-4b57-91ea-3f60d8b47c2e.json';
const NM_BLOB_FILE = 'e2c94b60-71fa-4d38-85b7-0a6c39e1f4d5.json';

/** A genuine Plotly figure: traces plus a layout. Two named series. */
const NM_PLOTLY_FIGURE = {
  data: [
    {
      type: 'scatter',
      mode: 'lines+markers',
      name: 'train',
      x: [1, 2, 3, 4, 5],
      y: [0.9, 0.6, 0.4, 0.3, 0.25],
    },
    {
      type: 'scatter',
      mode: 'lines',
      name: 'val',
      x: [1, 2, 3, 4, 5],
      y: [1, 0.7, 0.55, 0.5, 0.48],
    },
  ],
  // 640x480 is matplotlib's default canvas, and PlotlyView deletes both before
  // plotting. Kept here so that deletion is exercised: left in place the figure
  // renders at a fixed 640x480 and overflows any widget smaller than that.
  layout: {
    title: 'Native Plotly Figure',
    width: 640,
    height: 480,
    xaxis: { title: 'epoch' },
    yaxis: { title: 'loss' },
  },
};

/**
 * A matplotlib figure — which is to say, another Plotly figure.
 *
 * There is no second format to seed: an mpl figure is converted to Plotly at
 * log time, so "render matplotlib" and "render Plotly" are one code path. A
 * distinct trace type and title keep the two fixtures individually assertable.
 */
const NM_MPL_FIGURE = {
  data: [{ type: 'bar', name: 'counts', x: ['a', 'b', 'c'], y: [3, 7, 5] }],
  layout: { title: 'Matplotlib Bar Figure', width: 640, height: 480 },
};

/** A 4x4x4 lattice: 64 bare `[x, y, z]` triples, each axis spanning 0..3. */
const NM_POINT_CLOUD: number[][] = (() => {
  const points: number[][] = [];
  for (let z = 0; z < 4; z++) {
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) {
        points.push([x, y, z]);
      }
    }
  }
  return points;
})();

/**
 * The 8 corners of a unit cube as `[x, y, z, r, g, b]`.
 *
 * The 6-column form is a separate branch in the viewer (colour per point from
 * 0-255 channels) from the 3-column one above, and `detectMediaJson` accepts
 * 3 to 6 columns, so both widths need a fixture or half the classifier is
 * untested.
 */
const NM_POINT_CLOUD_RGB: number[][] = [
  [0, 0, 0, 255, 0, 0],
  [1, 0, 0, 0, 255, 0],
  [0, 1, 0, 0, 0, 255],
  [1, 1, 0, 255, 255, 0],
  [0, 0, 1, 255, 0, 255],
  [1, 0, 1, 0, 255, 255],
  [0, 1, 1, 255, 255, 255],
  [1, 1, 1, 128, 128, 128],
];

/**
 * A `.json` that is NEITHER a figure nor a cloud — `data` is present but its
 * first entry is an array, not a trace object.
 *
 * Pins the documented degradation: `detectMediaJson` returns null and the
 * widget falls back to a "View in Files" link rather than guessing.
 */
const NM_JSON_BLOB = {
  columns: ['a', 'b'],
  data: [
    [1, 2],
    [3, 4],
  ],
};

/** A `pluto.Html` artifact, rendered in a sandboxed iframe (no same-origin). */
const NM_HTML = `<!doctype html>
<html>
  <head><title>Native HTML artifact</title></head>
  <body>
    <h1 id="native-html-heading">Native HTML artifact</h1>
    <p>Rendered inside a sandboxed iframe.</p>
  </body>
</html>
`;

/**
 * `status/phase` on `nm-annotated-1`: 12 steps over 4 values.
 *
 * First-appearance order (warmup, train, eval, done) is also chronological
 * order, which is the ordering `canonicalLabels` is specified to produce and
 * is distinguishable from alphabetical (done, eval, train, warmup) — so a
 * regression to sorting shows up immediately.
 */
const NM_PHASE_RUN1 = [
  'warmup', 'warmup', 'warmup',
  'train', 'train', 'train', 'train', 'train',
  'eval', 'eval', 'eval',
  'done',
];

/** `status/phase` on `nm-annotated-2`: same 12 steps, only 3 distinct values. */
const NM_PHASE_RUN2 = [
  'warmup', 'warmup',
  'train', 'train', 'train', 'train', 'train', 'train', 'train', 'train',
  'eval', 'eval',
];

/**
 * A string series with a distinct value at every step.
 *
 * High cardinality is intended behaviour, not a defect, so there has to be a
 * fixture that shows what it looks like: 6 steps, 6 categories, 6 rows on the
 * Y axis.
 */
const NM_CHECKPOINT = [
  'ckpt-000', 'ckpt-001', 'ckpt-002', 'ckpt-003', 'ckpt-004', 'ckpt-005',
];

/**
 * `tables/eval_results` — a table with a bool column and a unicode column.
 *
 * Both were rejected by the old row schema, and one bad cell failed the whole
 * `result.map(parse)`, so the UI showed "No table data available" and lost
 * every intact row with it. Unicode appears in a column NAME as well as in
 * cells, since those are encoded and measured separately.
 */
const NM_TABLE_EVAL_STEPS = [
  {
    step: 0,
    rows: [
      ['resnet50', 0.912, 30, true, '精度良好'],
      ['vit-b16', 0.874, 30, false, '需要更多训练'],
      ['mobilenet', 0.803, 15, true, '軽量モデル ✅'],
    ],
  },
  {
    step: 5,
    rows: [
      ['resnet50', 0.934, 60, true, '精度良好'],
      ['vit-b16', 0.901, 60, true, '需要更多训练'],
      ['mobilenet', 0.821, 30, false, '軽量モデル ✅'],
    ],
  },
];

const NM_TABLE_EVAL_COLS = [
  { name: 'model', dtype: 'str' },
  { name: 'accuracy', dtype: 'float' },
  { name: 'epochs', dtype: 'int' },
  { name: 'passed', dtype: 'bool' },
  { name: '注释', dtype: 'str' },
];

/**
 * `tables/predictions` — media cells and a null cell.
 *
 * A media cell renders as its `path` string today. That is a documented
 * degradation rather than a bug, so it gets a fixture: if in-cell media
 * rendering ever lands, this test is what says so.
 */
const NM_TABLE_PREDICTIONS = {
  col: [
    { name: 'id', dtype: 'int' },
    { name: 'image', dtype: 'image-file' },
    { name: 'label', dtype: 'str' },
  ],
  table: [
    [0, { _type: 'image-file', path: 'media/images/pred_0_1a2b3c.png' }, 'cat'],
    [1, { _type: 'image-file', path: 'media/images/pred_1_4d5e6f.png' }, 'dog'],
    [2, null, 'missing'],
  ],
};

// ───────────────────────────────────────────────────────────────────────────
// RECORDED wandb-migration fixtures (setup steps 5k and 5l).
//
// PROVENANCE: every WM_* value below was captured on 2026-08-03 from a local
// developer dev stack holding runs imported by the real wandb exporter — the
// run ids and project names below identify them there. Nothing here was
// invented, and nothing here talks to wandb:
// once the rows are in the database Pluto cannot tell whether they arrived
// from a live import or from this file, so a recording exercises exactly the
// same code path with no credential and no network in CI. The one thing a
// recording cannot tell us — that wandb has not changed its export format
// since capture — belongs to the exporter's own tests, not to these.
//
// Source runs, by fixture:
//   WM_DET_* / WM_SEG_* / WM_MASK_PNG_BASE64
//                    run 4208, project `detection-demo`, run `fasterrcnn-r50-fpn`
//   WM_PLOTLY_FIGURE / WM_MPL_FIGURE / WM_POINT_CLOUD / WM_HTML
//                    run 4093, project `render-recheck`, run `plotly-html-3d`
//   WM_GALLERY_*     run 2205, project `migrate-edge-ordertest`,
//                    run `images_multi_index-00024`
//   WM_PHASE         run 4086, project `migrate-stringseries-test`,
//                    run `string_metric-00002`
//   WM_RESULTS_TABLE run 2204, project `migrate-edge-test`, run `tables-00039`
//   WM_MEDIA_TABLE   run 4223, project `media-table-probe`, run `media-in-table`
//   WM_PANELS / WM_CHART_TABLES
//                    run 4094, project `cc-render-check`, run `custom-charts`
//
// REDACTION: the developer's wandb entity, run URLs, run notes and the
// exporter's `wandb.summary` blocks (which carry content digests and
// `wandb-client-artifact://` handles) were stripped or replaced with obvious
// placeholders — `test-entity`, `wandb-run-0000`. What remains is structure
// and values.
//
// TRUNCATION: long series were cut to a handful of entries; each constant says
// what was cut. These are shape fixtures, not volume fixtures.
// ───────────────────────────────────────────────────────────────────────────

/** Captured migrated media, string metrics and tables. */
const WM_MEDIA_PROJECT = 'wandb-migrate-media';
/** Captured migrated custom-chart panels. */
const WM_CHARTS_PROJECT = 'wandb-migrate-charts';

/**
 * A migrated run's config, minus the exporter's `summary` block.
 *
 * The `wandb` key is what the migration adds; everything beside it is the
 * user's own config, kept because the mix is what the config table and the
 * side-by-side view render — nested objects, a null, a list, a bool, and
 * unicode.
 */
const WM_CONFIG_BASE = {
  lr: 0.005,
  model: 'faster-rcnn-r50-fpn',
  dataset: 'cityscapes-mini',
  batch_size: 8,
  bool_param: false,
  list_param: [0.0718887916216121, 0.941317015446328],
  null_param: null,
  nested: { a: { b: { c: { d: 0.4593246053204499, flag: false } } } },
  notes_unicode: '配置 ünïcode λ 🚀 café',
  wandb: {
    // Entity and run id replaced; that it is a URL at all is the readable part.
    url: 'https://wandb.ai/test-entity/detection-demo/runs/wandb-run-0000',
    state: 'finished',
  },
};

/**
 * `val/detections` step 0 — 6 predicted boxes and 6 ground-truth boxes.
 *
 * Every box carries `domain: "pixel"`, which is what the exporter emits, and
 * is why the fractional path needs the hand-written NM_* fixture: no recording
 * can cover it. The image is 480x320, so these coordinates only land on screen
 * if `resolveBox` honours the domain.
 */
const WM_DET_ANNOTATIONS_STEP0 = {
  "boxes": {
    "predictions": {
      "box_data": [
        {
          "position": {"minX": 70, "minY": 174, "maxX": 190, "maxY": 243},
          "class_id": 3,
          "box_caption": "car 0.62",
          "scores": {"confidence": 0.62},
          "domain": "pixel"
        },
        {
          "position": {"minX": 238, "minY": 144, "maxX": 331, "maxY": 223},
          "class_id": 3,
          "box_caption": "car 0.69",
          "scores": {"confidence": 0.69},
          "domain": "pixel"
        },
        {
          "position": {"minX": 352, "minY": 153, "maxX": 418, "maxY": 197},
          "class_id": 3,
          "box_caption": "car 0.66",
          "scores": {"confidence": 0.66},
          "domain": "pixel"
        },
        {
          "position": {"minX": 36, "minY": 189, "maxX": 48, "maxY": 249},
          "class_id": 4,
          "box_caption": "person 0.48",
          "scores": {"confidence": 0.48},
          "domain": "pixel"
        },
        {
          "position": {"minX": 196, "minY": 236, "maxX": 250, "maxY": 262},
          "class_id": 3,
          "box_caption": "car 0.41",
          "scores": {"confidence": 0.41},
          "domain": "pixel"
        },
        {
          "position": {"minX": 300, "minY": 60, "maxX": 318, "maxY": 108},
          "class_id": 5,
          "box_caption": "traffic light 0.7",
          "scores": {"confidence": 0.7},
          "domain": "pixel"
        }
      ],
      "class_labels": {"1": "road", "2": "sidewalk", "3": "car", "4": "person", "5": "traffic_light"}
    },
    "ground_truth": {
      "box_data": [
        {
          "position": {"minX": 60, "minY": 170, "maxX": 190, "maxY": 250},
          "class_id": 3,
          "box_caption": "car",
          "domain": "pixel"
        },
        {
          "position": {"minX": 250, "minY": 158, "maxX": 340, "maxY": 214},
          "class_id": 3,
          "box_caption": "car",
          "domain": "pixel"
        },
        {
          "position": {"minX": 352, "minY": 150, "maxX": 404, "maxY": 190},
          "class_id": 3,
          "box_caption": "car",
          "domain": "pixel"
        },
        {
          "position": {"minX": 420, "minY": 168, "maxX": 442, "maxY": 236},
          "class_id": 4,
          "box_caption": "person",
          "domain": "pixel"
        },
        {
          "position": {"minX": 34, "minY": 176, "maxX": 54, "maxY": 240},
          "class_id": 4,
          "box_caption": "person",
          "domain": "pixel"
        },
        {
          "position": {"minX": 300, "minY": 60, "maxX": 318, "maxY": 108},
          "class_id": 5,
          "box_caption": "traffic light",
          "domain": "pixel"
        }
      ],
      "class_labels": {"1": "road", "2": "sidewalk", "3": "car", "4": "person", "5": "traffic_light"}
    }
  }
};

/** `val/detections` step 1 — 7 predictions (one more than step 0), same 6 GT. */
const WM_DET_ANNOTATIONS_STEP1 = {
  "boxes": {
    "ground_truth": {
      "box_data": [
        {
          "position": {"minX": 60, "minY": 170, "maxX": 190, "maxY": 250},
          "class_id": 3,
          "box_caption": "car",
          "domain": "pixel"
        },
        {
          "position": {"minX": 250, "minY": 158, "maxX": 340, "maxY": 214},
          "class_id": 3,
          "box_caption": "car",
          "domain": "pixel"
        },
        {
          "position": {"minX": 352, "minY": 150, "maxX": 404, "maxY": 190},
          "class_id": 3,
          "box_caption": "car",
          "domain": "pixel"
        },
        {
          "position": {"minX": 420, "minY": 168, "maxX": 442, "maxY": 236},
          "class_id": 4,
          "box_caption": "person",
          "domain": "pixel"
        },
        {
          "position": {"minX": 34, "minY": 176, "maxX": 54, "maxY": 240},
          "class_id": 4,
          "box_caption": "person",
          "domain": "pixel"
        },
        {
          "position": {"minX": 300, "minY": 60, "maxX": 318, "maxY": 108},
          "class_id": 5,
          "box_caption": "traffic light",
          "domain": "pixel"
        }
      ],
      "class_labels": {"1": "road", "2": "sidewalk", "3": "car", "4": "person", "5": "traffic_light"}
    },
    "predictions": {
      "box_data": [
        {
          "position": {"minX": 59, "minY": 170, "maxX": 195, "maxY": 259},
          "class_id": 3,
          "box_caption": "car 0.74",
          "scores": {"confidence": 0.74},
          "domain": "pixel"
        },
        {
          "position": {"minX": 256, "minY": 167, "maxX": 335, "maxY": 210},
          "class_id": 3,
          "box_caption": "car 0.76",
          "scores": {"confidence": 0.76},
          "domain": "pixel"
        },
        {
          "position": {"minX": 348, "minY": 156, "maxX": 399, "maxY": 188},
          "class_id": 3,
          "box_caption": "car 0.77",
          "scores": {"confidence": 0.77},
          "domain": "pixel"
        },
        {
          "position": {"minX": 412, "minY": 159, "maxX": 449, "maxY": 241},
          "class_id": 4,
          "box_caption": "person 0.64",
          "scores": {"confidence": 0.64},
          "domain": "pixel"
        },
        {
          "position": {"minX": 40, "minY": 173, "maxX": 53, "maxY": 245},
          "class_id": 4,
          "box_caption": "person 0.62",
          "scores": {"confidence": 0.62},
          "domain": "pixel"
        },
        {
          "position": {"minX": 196, "minY": 236, "maxX": 250, "maxY": 262},
          "class_id": 3,
          "box_caption": "car 0.41",
          "scores": {"confidence": 0.41},
          "domain": "pixel"
        },
        {
          "position": {"minX": 300, "minY": 60, "maxX": 318, "maxY": 108},
          "class_id": 5,
          "box_caption": "traffic light 0.81",
          "scores": {"confidence": 0.81},
          "domain": "pixel"
        }
      ],
      "class_labels": {"1": "road", "2": "sidewalk", "3": "car", "4": "person", "5": "traffic_light"}
    }
  }
};

/**
 * `val/segmentation` — a mask reference and nothing else.
 *
 * `class_labels` is ASSEMBLED FROM VERIFIED PARTS rather than copied off one
 * export, and the distinction matters.
 *
 * The capture predates Trainy-ai/pluto#131. wandb keeps a mask's id→name key in
 * the RUN CONFIG rather than on the mask layer, so the exporter never carried
 * it and every migrated mask tinted nothing — which this fixture recorded
 * faithfully at the time. #131 now recovers it, so the shape below is what a
 * migration actually produces today.
 *
 * Verbatim: the layer name, the mask filenames, the PNG itself.
 *
 * The `{fileName, class_labels}` layer shape with STRING id keys is verified
 * against real post-#131 migrations on the dev stack — `mask-demo-fixed2`
 * (`{"0": "bg", "1": "thing-A", "2": "thing-B"}`) and `fixture-bm`.
 *
 * The label strings are verified for THIS scene from two independent places,
 * neither of which is a post-#131 migration of this run:
 *
 *   * `WM_DET`'s box layer below, which is verbatim from the same run and
 *     carries this exact id→name set. Box labels survived the original capture
 *     because wandb puts those in the `.boxes2D.json` sidecar, which the loader
 *     already inlined — only the MASK labels were hidden in the run config.
 *   * the `detection-native` project on the dev stack, the natively-logged twin
 *     of this scene, whose mask layers carry the same set.
 *
 * So the shape is confirmed and the names are confirmed, but assembled here
 * rather than copied off one post-fix export: `detection-demo` (runId 4208, the
 * migrated source of these very files) has NOT been re-migrated since #131 and
 * still shows a bare `{fileName}`. Re-migrate it and copy the result in when
 * convenient — that would make this fully verbatim again.
 *
 * Ids 1-5 are labelled and 0 is not, deliberately: the PNG holds 87,772 class-0
 * pixels against 65,828 of ids 1-5, so the tint is selective rather than
 * whole-canvas, and a test can prove BOTH that migrated masks now paint and
 * that unlabelled ids still stay clear. Re-record end to end when a real
 * post-#131 export is to hand.
 */
const WM_SEG_ANNOTATIONS_STEP0 = {
  "masks": {"predictions": {
    "fileName": "91f6e810-1a4e-4c49-89a4-bb3becdebfa5.mask.png",
    "class_labels": {"1": "road", "2": "sidewalk", "3": "car", "4": "person", "5": "traffic_light"}
  }}
};

const WM_SEG_ANNOTATIONS_STEP1 = {
  "masks": {"predictions": {
    "fileName": "81cc6e2e-1af4-4729-b71f-5e86461f05c4.mask.png",
    "class_labels": {"1": "road", "2": "sidewalk", "3": "car", "4": "person", "5": "traffic_light"}
  }}
};

/**
 * The real mask PNG both annotations above point at, base64.
 *
 * 480x320, 8-bit GREYSCALE (PNG colour type 0) rather than RGB, holding class
 * ids 0-5 in these proportions: 0 x87772, 1 x40042, 2 x7240, 3 x14906,
 * 4 x2776, 5 x864. Embedded as bytes rather than regenerated because the
 * greyscale encoding is itself part of what the reader has to cope with, and a
 * synthesised RGB mask would quietly stop testing it. 1688 bytes — the only
 * binary recording here.
 */
const WM_MASK_PNG_BASE64 = [
  'iVBORw0KGgoAAAANSUhEUgAAAeAAAAFACAAAAABBo/CnAAAGX0lEQVR4nO3d23riNhSAUYe27//AbUMv5lACPkhGkrd2',
  '1rqYbyYTjKPfAmKMvSwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABAZh9Xr8BM/nr5yt8XrEWd29UrQF8CJydwcgIn',
  'J3ByAicncHICJydwcgInJ3ByAicncHICJydwcgInJ3ByAicncHICJydwcgInJ3ByAicncHICJydwcgInJ3ByAicncHIC',
  'JydwcgInJ3ByAicncHICJydwcgInJ3ByAicncHICJydwcgInJzAAAAAAAAAAAAAAAAAAAAAAAAAAUOHj6hX4Nv44+oZ/',
  'u9ytc1UmJ3ByAicncHICJydwcgIn9+fVK1Do94Z4738Xtfr8AtvIHIH/H/t+fZOa4iFa3/MmmMEP26C+1eLPYH3fEn0G',
  'P26A+p4QfAbr+67QM/jL1qfvKZEDp+h7+Dbwyne2/MU67kP0bZq+ccdwCTyDv45a5L7Lcvvsu/z1SP+8cdvLPU2K2H2X',
  '5bZ0Tnxej8DlTzulPsKO3y+9J/FpoZ8/ZnILOpJBV2tGMYcy5lrNKeQkjrhO8wo4mgFXaWbxJnHBq+i1byn7Hew7ivZy',
  'OtwWN71gkzjW2uQQakxDrcykXvazRZrEgVZlXq97UuMMa9B90SM0i/CyoHugvdNxNrVsgoxskNXIKMYzcYiVyCrC4EZY',
  'h7wCjO43fpE1wvWFr18DuhI4OYGT8xzc2Y+9XNft9TCDh7humAUe47K9HgKPctFIC9zB+nH610xigXvY+CTGFYMtcBdb',
  'hccPt8B9bH2aavh4C9zJZuHBIy5wL5ufiBw75AJ3s1145KAL3M/2p5oHjrrAHe0UHjbub73Z0P6T3lu2xiPIoYtb7tsX',
  'PRn1ERczuK/LJ7HAne2cXmTI2Avc217hAaMvcHd7pwjqP/wC97dbuHcAgQfYPc1X5wICj7BfuGsDgYfYP1VfzwgCj3G/',
  '6mFa4FEuepj+xsdFj97Ned+9VnOvXZdm8DgHT8R9Ugg80MFZkbu0EHiko8Idagg81NGZzdvnEHisw8Ktgwg82OHVCRoX',
  'EXi0/V0eS+tJLPB4QyexwBc4Ltwui8BXOL5MUL/zLDJCQeFGZQS+RsGlvtqkEfgiJYVbxBH4KiWX62tQR+DLFBV+u4/A',
  '1znc5bEs7wcS+EoDJvE7t7ZxvK3ourlvjfP5Q3bkbWH/OJ4GTmfSt43e174+OYPlbabzHP7GR1VGcVz48+HPWqbi9Qof',
  'pc+9nBY4gNLn4TOxBI6gaJfHcqpW7TP8l7vo/RL/WPCTsFQoHcvan7hymzDhe+n1MF01CZ8Xbga3VDyaVT90zQZh+nZV',
  'vMujqkP5JFxZrBncVvl4lv/cxVuD6dtf+W7L8hqFG836As3g1ipGtPBHL9sUTN9BKt56KGxSsslsLsoM7qDxJC7YDkzf',
  'oRpP4sPtpSpv7zc3v4eaB8bDSXy0sJq+8jbSsvDBsvS9RNWLm/3E+6f2qbkffRtqV3hvSfpep+4XlJ3E2wuqe/Gsb2Ot',
  'Cm9fNKLqDvRtrnInw1bijcVU/u6rbw9NJvH6QvQNocUkXltG7a4rfXtpUHhlEfrGUbu3/zXxyxKq9zzr29PbhZ8XoG8w',
  '1e/YPSV+ur2H53DeLPzl5qZvRPXvuj8mvm38vYi+I9SP8mPIj9Wv9rpnznnjYfr3TfWN7PzD9M9bnjgsR9+RThf+cUN9',
  'wztxgOPnr9udOapO39FOFv7QdxZnDlL+XD5OHRSr7xVOFdZ3HmeG/cyJPUrPN0BrpwoPuRfaODG37J6cS/Xwe/toMrUB',
  'HH01m8oEjo6dTl0En16YT1UGny6bUE2IisD6htH+TA91C6W3Dufj0TeU4l0epYH1jabpCWrtfg6orElRYHlDanZNHn2D',
  'anTlNH3DanKRWn0Da3ApcX1DO8xzFFjf4I4CHQTWN7yDX2H3A+s7g91Ku4H1ncNep73A+s5ip9R2YLsnJ7LdajOwvFPZ',
  'zLUVWN/JbAXbCKzvdDaSrQfWd0Lr0VYD6zul1ZfFa4H1ndVKuZXA+s7rtd1rYH1n9lLvJbC+c3vu9xxY39k9Fbzt/i8T',
  '+trwS2C7n1P4UvG29R/M6zHkbf3LTO3hofj/wPpm8rvm7eUrpPCr5+3p32Txs+jty79I5EfT28PfyeW+LD8D65vTffkR',
  'WN+s7sty0zez+/IfpVD6+gU10pcAAAAASUVORK5CYII=',
].join('');

/**
 * The `plotly` artifact body — a one-trace bar figure.
 *
 * TRUNCATED: `layout` held nothing but Plotly's stock 6KB `template`, which no
 * code path here reads, so it was emptied. `data` is verbatim.
 */
const WM_PLOTLY_FIGURE = {"data": [{"y": [2, 1, 3], "type": "bar"}], "layout": {}};

/**
 * The `mpl` artifact body — a matplotlib figure, already converted to Plotly by
 * wandb at log time. This is why matplotlib needs no second viewer.
 *
 * Kept for `width: 640` / `height: 480` in its layout: matplotlib's default
 * canvas travelling through the conversion, and exactly what `PlotlyView` has
 * to delete or the figure renders at a fixed 640x480 and overflows its widget.
 *
 * TRUNCATED: `layout.template` removed; everything else verbatim.
 */
const WM_MPL_FIGURE = {
  "data": [
    {
      "line": {"color": "rgba (31, 119, 180, 1)", "dash": "solid", "width": 1.5},
      "mode": "lines",
      "name": "_child0",
      "x": [0.0, 1.0, 2.0, 3.0],
      "xaxis": "x",
      "y": [1.0, 3.0, 2.0, 4.0],
      "yaxis": "y",
      "type": "scatter"
    }
  ],
  "layout": {
    "autosize": false,
    "height": 480,
    "hovermode": "closest",
    "width": 640,
    "margin": {"b": 52, "l": 80, "pad": 0, "r": 63, "t": 57},
    "xaxis": {
      "anchor": "y",
      "domain": [0.0, 1.0],
      "mirror": "ticks",
      "nticks": 9,
      "range": [-0.15000000000000002, 3.15],
      "showgrid": false,
      "showline": true,
      "side": "bottom",
      "tickfont": {"size": 10.0},
      "ticks": "inside",
      "type": "linear",
      "zeroline": false
    },
    "yaxis": {
      "anchor": "x",
      "domain": [0.0, 1.0],
      "mirror": "ticks",
      "nticks": 9,
      "range": [0.85, 4.15],
      "showgrid": false,
      "showline": true,
      "side": "left",
      "tickfont": {"size": 10.0},
      "ticks": "inside",
      "type": "linear",
      "zeroline": false
    },
    "title": {"text": "mpl", "font": {"color": "#000000", "size": 12.0}}
  }
};

/**
 * The `cloud` artifact body — a `wandb.Object3D` point cloud: a bare array of
 * `[x, y, z]` triples, with no wrapper object to identify it by.
 *
 * TRUNCATED: 200 points to the first 12, each rounded to 6 decimals.
 */
const WM_POINT_CLOUD = [
  [0.18027, 0.019475, 0.463219],
  [0.724934, 0.420204, 0.485427],
  [0.012781, 0.487372, 0.941807],
  [0.850795, 0.729964, 0.108736],
  [0.893904, 0.857154, 0.165087],
  [0.632334, 0.020484, 0.116737],
  [0.316367, 0.157912, 0.75898],
  [0.818275, 0.344624, 0.318799],
  [0.111661, 0.083953, 0.712726],
  [0.599543, 0.055674, 0.479797],
  [0.401676, 0.847979, 0.717849],
  [0.602064, 0.552384, 0.949102]
];

/**
 * The `html` artifact body, verbatim (136 bytes).
 *
 * The stylesheet link is wandb's own boilerplate and names no user; it is left
 * in because a blocked external stylesheet inside the sandboxed iframe is
 * precisely what production shows.
 */
const WM_HTML = "<base target=\"_blank\"><link rel=\"stylesheet\" type=\"text/css\" href=\"https://app.wandb.ai/normalize.css\" /><h1>edge</h1><p>unsupported</p>";

/**
 * `gallery` — one `log()` call passing a list of images, so every file shares a
 * step and is separated only by `sampleIndex`.
 *
 * The naming is the exporter's: file `idx<N>.<uuid>.png`, caption `idx<N>`.
 * Twelve samples matter — at 12, lexical file-name order (idx0, idx1, idx10,
 * idx11, idx2, ...) diverges from logged order, so an ordering assertion can
 * only pass if `sampleIndex` is doing the work.
 *
 * TRUNCATED: 16 samples at step 0 down to 12, and the run's 5 steps down to 2.
 */
const WM_GALLERY_UUIDS = [
  '739222cc-93a1-4093-a965-aee3cdac1a9d',
  'cc0ae04f-a934-49e1-b264-2d4db6fff180',
  '51904189-d037-47b8-8406-12b1b146ec1a',
  'e9486798-ccd3-43e0-8627-d345940c4fd4',
  '5e59e6e4-48e0-4637-a4bf-0d322907ca87',
  'e99e3d6d-fbdd-40ac-bb35-aaad74e756c7',
  '0ccacac1-ada9-4311-9d65-e42aff7dcdf1',
  '5003f6bb-018c-4a15-badc-af535e0584a6',
  '393648ae-97a0-4a7c-a0e6-5f2d69d9c549',
  'c69af029-3158-43f1-b712-6f6fb5ec4630',
  'b3ea44dd-39df-4107-a2ba-ff30297d05d4',
  '2558e5c7-0deb-4031-bd93-f137b3cc1fcd',
];

/** Step 1 of the same log: only two samples, as in the source run. */
const WM_GALLERY_UUIDS_STEP1 = [
  '6519de0b-7bf4-4b41-b3f6-9546e3923b40',
  'd54a0e50-7697-4d1a-86a5-86b63408e88b',
];

/**
 * `phase` — a migrated non-numeric per-step series, verbatim (all 5 steps).
 *
 * The `data` column holds the raw value. wandb itself kept only the final one,
 * in the run summary, which is the loss this feature exists to undo.
 */
const WM_PHASE = ['warmup', 'train', 'train', 'eval', 'done'];

/**
 * `results` — a migrated `wandb.Table` with a BOOL column and unicode cells.
 *
 * Both used to fail the row schema, and one bad cell failed the whole parse, so
 * the UI reported "No table data available" and lost every intact row with it.
 * Note `dtype: "bool"`, outside pluto's own int/float/str set, and the
 * `type`/`v` envelope the exporter wraps every table in.
 *
 * TRUNCATED: 13 rows to 5.
 */
const WM_RESULTS_TABLE = {
  "table": [
    [0, "row-0 ünï", -2.311708612409621, false],
    [1, "row-1 ünï", -1.041355883982314, true],
    [2, "row-2 ünï", -0.12389254211896152, false],
    [3, "row-3 ünï", 1.9313200098043388, true],
    [4, "row-4 ünï", -2.330581628849119, false]
  ],
  "col": [
    {"name": "idx", "dtype": "int"},
    {"name": "text", "dtype": "str"},
    {"name": "score", "dtype": "float"},
    {"name": "flag", "dtype": "bool"}
  ],
  "type": "Table",
  "v": 1
};

/**
 * `media_table` — a migrated table whose image column survived export as the
 * literal string "Image", with `dtype: "str"`.
 *
 * Verbatim, and worth pinning: the renderer also handles an object media cell
 * (`{_type, path}`) and shows its `path`, but this exporter does not produce
 * one, so the degradation users actually see is this. The object form is
 * covered by the hand-written `tables/predictions` fixture.
 */
const WM_MEDIA_TABLE = {
  "table": [[0, "Image", 0.0], [1, "Image", 0.25], [2, "Image", 0.5], [3, "Image", 0.75]],
  "col": [
    {"name": "idx", "dtype": "int"},
    {"name": "img", "dtype": "str"},
    {"name": "score", "dtype": "float"}
  ],
  "type": "Table",
  "v": 1
};

/**
 * `config.wandb.custom_charts` — six real `wandb.plot.*` panels, verbatim.
 *
 * Between them they cover every dispatch route the viewer has: `bar`, `line`
 * and `scatter` reach a preset through the `preset` name; `confusion_matrix`
 * is raw Vega with bound signals (the "Normalized" toggle); and the two
 * `area-under-curve` panels are the only ones carrying `x-axis-title` /
 * `y-axis-title` in `strings`.
 *
 * This is the one fixture with no native counterpart: both read sites
 * (`~hooks/use-custom-chart-panels.ts` and the run page's `index.tsx`) look at
 * `config.wandb.custom_charts` and nowhere else, and no SDK call writes panels
 * anywhere — a "native custom chart" does not exist.
 */
const WM_PANELS = [
  {
    "key": "bar",
    "title": "bar",
    "fields": {"label": "label", "value": "value"},
    "preset": "bar",
    "strings": {"title": "bar"},
    "specLang": "vega-lite",
    "tableKey": "bar_table",
    "panelDefId": "wandb/bar/v0"
  },
  {
    "key": "confmat",
    "title": "Confusion Matrix Curve",
    "fields": {"Actual": "Actual", "Predicted": "Predicted", "nPredictions": "nPredictions"},
    "preset": "confusion_matrix",
    "strings": {"title": "Confusion Matrix Curve"},
    "specLang": "vega-lite",
    "tableKey": "confmat_table",
    "panelDefId": "wandb/confusion_matrix/v1"
  },
  {
    "key": "line",
    "title": "line",
    "fields": {"x": "x", "y": "y"},
    "preset": "line",
    "strings": {"title": "line"},
    "specLang": "vega-lite",
    "tableKey": "line_table",
    "panelDefId": "wandb/line/v0"
  },
  {
    "key": "pr",
    "title": "Precision-Recall Curve",
    "fields": {"x": "recall", "y": "precision", "class": "class"},
    "preset": "area-under-curve",
    "strings": {
      "title": "Precision-Recall Curve",
      "x-axis-title": "Recall",
      "y-axis-title": "Precision"
    },
    "specLang": "vega-lite",
    "tableKey": "pr_table",
    "panelDefId": "wandb/area-under-curve/v0"
  },
  {
    "key": "roc",
    "title": "ROC Curve",
    "fields": {"x": "fpr", "y": "tpr", "class": "class"},
    "preset": "area-under-curve",
    "strings": {
      "title": "ROC Curve",
      "x-axis-title": "False positive rate",
      "y-axis-title": "True positive rate"
    },
    "specLang": "vega-lite",
    "tableKey": "roc_table",
    "panelDefId": "wandb/area-under-curve/v0"
  },
  {
    "key": "scatter",
    "title": "scatter",
    "fields": {"x": "x", "y": "y"},
    "preset": "scatter",
    "strings": {"title": "scatter"},
    "specLang": "vega-lite",
    "tableKey": "scatter_table",
    "panelDefId": "wandb/scatter/v0"
  }
];

/**
 * The tables those panels read, keyed by `tableKey`.
 *
 * Verbatim, each at the step the source run logged it at (0..5) — a detail
 * worth keeping, since `latestTable` picks the newest step and would draw the
 * wrong body if these were flattened onto one shared step.
 *
 * TRUNCATED: `pr_table` from 63 rows (21 thresholds x 3 classes) to 9 (3 x 3).
 */
const WM_CHART_TABLES: Record<string, { step: number; data: Record<string, unknown> }> = {
  "bar_table": {
    "step": 0,
    "data": {
      "table": [["c0", 0.0], ["c1", 0.2], ["c2", 0.4], ["c3", 0.6], ["c4", 0.8]],
      "col": [{"name": "label", "dtype": "str"}, {"name": "value", "dtype": "float"}],
      "type": "Table",
      "v": 1
    }
  },
  "line_table": {
    "step": 1,
    "data": {
      "table": [
        [0, 0],
        [1, 1],
        [2, 4],
        [3, 9],
        [4, 16],
        [5, 25],
        [6, 36],
        [7, 49],
        [8, 64],
        [9, 81]
      ],
      "col": [{"name": "x", "dtype": "int"}, {"name": "y", "dtype": "int"}],
      "type": "Table",
      "v": 1
    }
  },
  "scatter_table": {
    "step": 2,
    "data": {
      "table": [
        [0, 0],
        [1, 1],
        [2, 4],
        [3, 9],
        [4, 16],
        [5, 25],
        [6, 36],
        [7, 49],
        [8, 64],
        [9, 81]
      ],
      "col": [{"name": "x", "dtype": "int"}, {"name": "y", "dtype": "int"}],
      "type": "Table",
      "v": 1
    }
  },
  "confmat_table": {
    "step": 3,
    "data": {
      "table": [
        ["a", "a", 3.0],
        ["a", "b", 0.0],
        ["a", "c", 0.0],
        ["b", "a", 0.0],
        ["b", "b", 2.0],
        ["b", "c", 1.0],
        ["c", "a", 0.0],
        ["c", "b", 1.0],
        ["c", "c", 2.0]
      ],
      "col": [
        {"name": "Actual", "dtype": "str"},
        {"name": "Predicted", "dtype": "str"},
        {"name": "nPredictions", "dtype": "float"}
      ],
      "type": "Table",
      "v": 1
    }
  },
  "roc_table": {
    "step": 4,
    "data": {
      "table": [
        ["a", 0.0, 0.0],
        ["a", 0.0, 1.0],
        ["a", 1.0, 1.0],
        ["b", 0.0, 0.0],
        ["b", 0.0, 1.0],
        ["b", 1.0, 1.0],
        ["c", 0.0, 0.0],
        ["c", 0.0, 1.0],
        ["c", 1.0, 1.0]
      ],
      "col": [
        {"name": "class", "dtype": "str"},
        {"name": "fpr", "dtype": "float"},
        {"name": "tpr", "dtype": "float"}
      ],
      "type": "Table",
      "v": 1
    }
  },
  "pr_table": {
    "step": 5,
    "data": {
      "table": [
        ["a", 1.0, 1.0],
        ["a", 1.0, 0.5],
        ["a", 1.0, 0.0],
        ["b", 1.0, 1.0],
        ["b", 1.0, 0.5],
        ["b", 1.0, 0.0],
        ["c", 1.0, 1.0],
        ["c", 1.0, 0.5],
        ["c", 1.0, 0.0]
      ],
      "col": [
        {"name": "class", "dtype": "str"},
        {"name": "precision", "dtype": "float"},
        {"name": "recall", "dtype": "float"}
      ],
      "type": "Table",
      "v": 1
    }
  }
};

async function setupTestData(): Promise<TestData> {
  console.log('🔧 Setting up test database...\n');

  // 1. Create or get test user
  console.log('1️⃣  Creating test user...');
  const testEmail = 'test-smoke@mlop.local';
  const testPassword = 'TestPassword123!';

  let user = await prisma.user.findUnique({
    where: { email: testEmail },
  });

  if (!user) {
    user = await prisma.user.create({
      data: {
        id: nanoid(),
        email: testEmail,
        name: 'Smoke Test User',
        emailVerified: true,
        finishedOnboarding: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    console.log(`   ✓ Created user: ${user.email} (ID: ${user.id})`);
  } else {
    console.log(`   ✓ User already exists: ${user.email} (ID: ${user.id})`);
  }

  // Ensure user has a password for email/password auth
  // Use better-auth's custom password hashing (scrypt with salt:hash format)
  const { scryptAsync } = await import('@noble/hashes/scrypt.js');
  const { randomBytes } = crypto;

  const salt = randomBytes(16).toString('hex');
  const key = await scryptAsync(testPassword.normalize('NFKC'), salt, {
    N: 16384,
    r: 16,
    p: 1,
    dkLen: 64,
    maxmem: 128 * 16384 * 16 * 2
  });
  const hashedPassword = `${salt}:${Buffer.from(key).toString('hex')}`;

  const existingAccount = await prisma.account.findFirst({
    where: {
      userId: user.id,
      providerId: 'credential',
    },
  });

  if (!existingAccount) {
    await prisma.account.create({
      data: {
        id: nanoid(),
        userId: user.id,
        accountId: user.id,
        providerId: 'credential',
        password: hashedPassword,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    console.log(`   ✓ Created password for user`);
  } else {
    // Update password
    await prisma.account.update({
      where: { id: existingAccount.id },
      data: { password: hashedPassword },
    });
    console.log(`   ✓ Updated password for user`);
  }

  // 2. Create or get test organization
  console.log('\n2️⃣  Creating test organization...');
  const orgSlug = 'smoke-test-org';
  const { org } = await ensureTestOrg(user.id, orgSlug, 'Smoke Test Organization');

  // 2b. Create second test organization (for org switching tests)
  console.log('\n2️⃣b Creating second test organization...');
  const org2Slug = 'smoke-test-org-2';
  const { org: org2 } = await ensureTestOrg(user.id, org2Slug, 'Smoke Test Organization 2', '_2');

  // Create project and run in org 2 for org-switching tests
  let project2 = await prisma.projects.findUnique({
    where: {
      organizationId_name: {
        organizationId: org2.id,
        name: 'org2-test-project',
      },
    },
  });

  if (!project2) {
    project2 = await prisma.projects.create({
      data: {
        name: 'org2-test-project',
        organizationId: org2.id,
      },
    });
    console.log(`   ✓ Created project in org 2: ${project2.name}`);
  }

  // 3. Create or get test API key
  console.log('\n3️⃣  Creating test API key...');
  const apiKeyPrefix = 'mlps_smoke_test_';
  const apiKeySecret = crypto.randomBytes(32).toString('hex');
  const fullApiKey = `${apiKeyPrefix}${apiKeySecret}`;
  const hashedKey = await hashApiKey(fullApiKey);

  // Check if a smoke test API key already exists
  let apiKey = await prisma.apiKey.findFirst({
    where: {
      organizationId: org.id,
      name: 'Smoke Test Key',
    },
  });

  if (!apiKey) {
    apiKey = await prisma.apiKey.create({
      data: {
        id: nanoid(),
        name: 'Smoke Test Key',
        key: hashedKey,
        keyString: apiKeyPrefix + '***',
        isHashed: true,
        userId: user.id,
        organizationId: org.id,
        createdAt: new Date(),
      },
    });
    console.log(`   ✓ Created API key: ${fullApiKey.substring(0, 20)}...`);
  } else {
    // Update with new key
    await prisma.apiKey.update({
      where: { id: apiKey.id },
      data: { key: hashedKey },
    });
    console.log(`   ✓ Updated existing API key: ${fullApiKey.substring(0, 20)}...`);
  }

  // 3b. Create or get test API key for org 2
  console.log('\n3️⃣b Creating test API key for org 2...');
  const apiKey2Prefix = 'mlps_smoke_test_org2_';
  const apiKey2Secret = crypto.randomBytes(32).toString('hex');
  const fullApiKey2 = `${apiKey2Prefix}${apiKey2Secret}`;
  const hashedKey2 = await hashApiKey(fullApiKey2);

  let apiKey2 = await prisma.apiKey.findFirst({
    where: {
      organizationId: org2.id,
      name: 'Smoke Test Key Org 2',
    },
  });

  if (!apiKey2) {
    apiKey2 = await prisma.apiKey.create({
      data: {
        id: nanoid(),
        name: 'Smoke Test Key Org 2',
        key: hashedKey2,
        keyString: apiKey2Prefix + '***',
        isHashed: true,
        userId: user.id,
        organizationId: org2.id,
        createdAt: new Date(),
      },
    });
    console.log(`   ✓ Created API key for org 2: ${fullApiKey2.substring(0, 25)}...`);
  } else {
    // Update with new key
    await prisma.apiKey.update({
      where: { id: apiKey2.id },
      data: { key: hashedKey2 },
    });
    console.log(`   ✓ Updated existing API key for org 2: ${fullApiKey2.substring(0, 25)}...`);
  }

  // 3c. Create or refresh an EXPIRED test API key (expiresAt in the past).
  // Smoke tests use this to verify the backend rejects expired keys. The
  // create endpoint forbids past expiry dates, so it is seeded directly.
  // Keep this plaintext value in sync with smoke.test.ts (EXPIRED_API_KEY).
  console.log('\n3️⃣c Creating expired test API key...');
  const expiredApiKeyValue = 'mlps_smoke_test_expired_do_not_use';
  const expiredHashedKey = await hashApiKey(expiredApiKeyValue);
  const pastExpiry = new Date(Date.now() - 24 * 60 * 60 * 1000); // 1 day ago

  const existingExpiredKey = await prisma.apiKey.findFirst({
    where: { organizationId: org.id, name: 'Smoke Test Key (Expired)' },
  });

  if (!existingExpiredKey) {
    await prisma.apiKey.create({
      data: {
        id: nanoid(),
        name: 'Smoke Test Key (Expired)',
        key: expiredHashedKey,
        keyString: 'mlps_smoke_test_expired_***',
        isHashed: true,
        userId: user.id,
        organizationId: org.id,
        createdAt: new Date(),
        expiresAt: pastExpiry,
      },
    });
    console.log('   ✓ Created expired API key');
  } else {
    await prisma.apiKey.update({
      where: { id: existingExpiredKey.id },
      data: { key: expiredHashedKey, expiresAt: pastExpiry },
    });
    console.log('   ✓ Updated expired API key');
  }

  // 3d. Create or refresh a REVOKED test API key (revokedAt in the past).
  // Smoke tests use this to verify the backend rejects revoked (soft-deleted)
  // keys. Keep this plaintext value in sync with smoke.test.ts (REVOKED_API_KEY).
  console.log('\n3️⃣d Creating revoked test API key...');
  const revokedApiKeyValue = 'mlps_smoke_test_revoked_do_not_use';
  const revokedHashedKey = await hashApiKey(revokedApiKeyValue);
  const revokedAt = new Date(Date.now() - 24 * 60 * 60 * 1000); // 1 day ago

  const existingRevokedKey = await prisma.apiKey.findFirst({
    where: { organizationId: org.id, name: 'Smoke Test Key (Revoked)' },
  });

  if (!existingRevokedKey) {
    await prisma.apiKey.create({
      data: {
        id: nanoid(),
        name: 'Smoke Test Key (Revoked)',
        key: revokedHashedKey,
        keyString: 'mlps_smoke_test_revoked_***',
        isHashed: true,
        userId: user.id,
        organizationId: org.id,
        createdAt: new Date(),
        revokedAt,
      },
    });
    console.log('   ✓ Created revoked API key');
  } else {
    await prisma.apiKey.update({
      where: { id: existingRevokedKey.id },
      data: { key: revokedHashedKey, revokedAt },
    });
    console.log('   ✓ Updated revoked API key');
  }

  // 4. Create or get test projects (multiple for pagination tests)
  console.log('\n4️⃣  Creating test projects...');
  // `dedup-e2e-project` exists so dedup-* E2E specs don't pollute
  // smoke-test-project (which sort-pagination tests run against). The runs
  // those specs create stay status=RUNNING for a brief moment and would
  // otherwise show up at the top of smoke-test-project's runs table,
  // tripping pagination assertions.
  const projectNames = ['smoke-test-project', 'test-project-2', 'test-project-3', 'dedup-e2e-project', 'bars-test-project'];
  const projects = [];

  for (const projectName of projectNames) {
    let project = await prisma.projects.findUnique({
      where: {
        organizationId_name: {
          organizationId: org.id,
          name: projectName,
        },
      },
    });

    if (!project) {
      project = await prisma.projects.create({
        data: {
          name: projectName,
          organizationId: org.id,
        },
      });
      console.log(`   ✓ Created project: ${project.name}`);
    } else {
      console.log(`   ✓ Project already exists: ${project.name}`);
    }
    projects.push(project);
  }

  const project = projects[0]; // Main test project

  // 5. Create test runs with graph data
  console.log('\n5️⃣  Creating test runs with graph data...');

  // Check if runs already exist
  const existingRuns = await prisma.runs.findMany({
    where: {
      projectId: project.id,
      organizationId: org.id,
    },
  });

  if (existingRuns.length === 0) {
    // Create 2 test runs
    const runNames = ['test-run-1', 'test-run-2'];

    for (const runName of runNames) {
      const run = await prisma.runs.create({
        data: {
          name: runName,
          organizationId: org.id,
          projectId: project.id,
          createdById: user.id,
          creatorApiKeyId: apiKey.id,
          status: 'COMPLETED',
          config: {
            framework: 'pytorch',
            version: '2.0',
          },
          systemMetadata: {
            hostname: 'test-host',
            python_version: '3.11',
          },
        },
      });

      // Create graph nodes
      const nodes = await Promise.all([
        prisma.runGraphNode.create({
          data: {
            runId: run.id,
            name: 'input_layer',
            depth: 0,
            type: 'input',
            order: 0,
            label: 'Input Layer',
            nodeId: 'node_input_1',
            nodeType: 'IO',
            params: { shape: [28, 28, 1] },
          },
        }),
        prisma.runGraphNode.create({
          data: {
            runId: run.id,
            name: 'conv2d_1',
            depth: 1,
            type: 'conv',
            order: 1,
            label: 'Conv2D Layer 1',
            nodeId: 'node_conv_1',
            nodeType: 'MODULE',
            params: { filters: 32, kernel_size: [3, 3] },
          },
        }),
        prisma.runGraphNode.create({
          data: {
            runId: run.id,
            name: 'activation_1',
            depth: 2,
            type: 'activation',
            order: 2,
            label: 'ReLU Activation',
            nodeId: 'node_activation_1',
            nodeType: 'MODULE',
            params: { type: 'relu' },
          },
        }),
        prisma.runGraphNode.create({
          data: {
            runId: run.id,
            name: 'dense_1',
            depth: 3,
            type: 'dense',
            order: 3,
            label: 'Dense Layer',
            nodeId: 'node_dense_1',
            nodeType: 'MODULE',
            params: { units: 128 },
          },
        }),
        prisma.runGraphNode.create({
          data: {
            runId: run.id,
            name: 'output_layer',
            depth: 4,
            type: 'output',
            order: 4,
            label: 'Output Layer',
            nodeId: 'node_output_1',
            nodeType: 'IO',
            params: { units: 10 },
          },
        }),
      ]);

      // Create edges connecting the nodes
      await prisma.runGraphEdge.createMany({
        data: [
          { runId: run.id, sourceId: 'node_input_1', targetId: 'node_conv_1' },
          { runId: run.id, sourceId: 'node_conv_1', targetId: 'node_activation_1' },
          { runId: run.id, sourceId: 'node_activation_1', targetId: 'node_dense_1' },
          { runId: run.id, sourceId: 'node_dense_1', targetId: 'node_output_1' },
        ],
      });

      console.log(`   ✓ Created run: ${run.name} with ${nodes.length} nodes and 4 edges`);
    }
  } else {
    console.log(`   ✓ Runs already exist (${existingRuns.length} runs found)`);
  }

  // 5b. Create bulk runs for server-side search testing
  console.log(`\n5️⃣b Creating ${SEARCH_TEST_RUN_COUNT + 1} bulk runs for search testing...`);

  // Check if bulk runs already exist (check for the needle run)
  const needleRun = await prisma.runs.findFirst({
    where: {
      projectId: project.id,
      organizationId: org.id,
      name: 'hidden-needle-experiment',
    },
  });

  if (!needleRun) {
    // Create bulk runs with sequential names
    // First 10 runs get incrementing tag counts for tags-column-width e2e test:
    //   bulk-run-000: 1 tag, bulk-run-001: 2 tags, ..., bulk-run-009: 10 tags
    const TAG_POOL = ['training', 'eval', 'sweep', 'baseline', 'production', 'debug', 'nightly', 'gpu', 'distributed', 'final'];
    const bulkRunData = Array.from({ length: SEARCH_TEST_RUN_COUNT }, (_, i) => ({
      name: (i >= 11 && i <= 13) ? `a-bulk-run-${String(i).padStart(3, '0')}` : `bulk-run-${String(i).padStart(3, '0')}`,
      organizationId: org.id,
      projectId: project.id,
      createdById: user.id,
      creatorApiKeyId: apiKey.id,
      status: 'COMPLETED' as const,
      ...(i < 10 ? { tags: TAG_POOL.slice(0, i + 1) } : {}),
      config: {
        epochs: 100,
        lr: 0.001,
        batch_size: 32,
        // Python repr strings to exercise JSON pretty-print in side-by-side view
        dataset: `{'path': 'acme/eval-suite', 'name': '${['LOOP_CITY-5T', 'MODEL_A', 'BASELINE_B'][i % 3]}', 'split': 'valid'}`,
        optimizer: "{'type': 'AdamW', 'betas': [0.9, 0.999], 'weight_decay': 0.01, 'eps': 1e-08}",
      },
      systemMetadata: { hostname: 'test-host', python: '3.11' },
      updatedAt: new Date(),
    }));

    // Add special "needle" run for search testing (hidden in pagination)
    // Has 'needle-tag' for tag filtering test - verifies tag filter finds runs beyond first page
    bulkRunData.push({
      name: 'hidden-needle-experiment',
      organizationId: org.id,
      projectId: project.id,
      createdById: user.id,
      creatorApiKeyId: apiKey.id,
      status: 'COMPLETED' as const,
      tags: ['needle-tag'], // Unique tag for tag filtering test
      config: { epochs: 50, lr: 0.01, batch_size: 32, dataset: 'needle-dataset', optimizer: 'SGD' },
      systemMetadata: { hostname: 'needle-host', python: '3.11' },
      updatedAt: new Date(),
    });

    // Add nan-inf-metrics run for Test 24.2b (NaN/Inf metric visibility)
    bulkRunData.push({
      name: 'nan-inf-metrics',
      organizationId: org.id,
      projectId: project.id,
      createdById: user.id,
      creatorApiKeyId: apiKey.id,
      status: 'COMPLETED' as const,
      config: { epochs: 100, lr: 0.001, batch_size: 32, dataset: 'nan-inf-dataset', optimizer: 'AdamW' },
      systemMetadata: { hostname: 'test-host', python: '3.11' },
      updatedAt: new Date(),
    });

    // Add one RUNNING run for tests that need to exercise auto-refresh
    // polling behavior on the individual-run page. The `a-running-run-001`
    // name keeps it grouped near the other media-rich `a-bulk-run-*` runs
    // in alphabetical order, and `status: 'RUNNING'` is enough — frontend
    // gates auto-refresh on `runData.status === "RUNNING"`, no actual
    // ongoing data ingestion or heartbeat needed.
    bulkRunData.push({
      name: 'a-running-run-001',
      organizationId: org.id,
      projectId: project.id,
      createdById: user.id,
      creatorApiKeyId: apiKey.id,
      status: 'RUNNING' as const,
      config: { epochs: 100, lr: 0.001, batch_size: 32, dataset: 'running-run-dataset', optimizer: 'AdamW' },
      systemMetadata: { hostname: 'test-host', python: '3.11' },
      updatedAt: new Date(),
    });

    // Add a dedicated run with a nested config.checkpoint.r2_prefix and a
    // distinctive model.name + trainer.lr so the /api/runs/list fieldFilters
    // smoke tests (and MCP config_filter parsing) have deterministic targets
    // mirroring the feedback example ("checkpoint.r2_prefix contains 37a").
    bulkRunData.push({
      name: 'config-filter-target',
      organizationId: org.id,
      projectId: project.id,
      createdById: user.id,
      creatorApiKeyId: apiKey.id,
      status: 'COMPLETED' as const,
      config: {
        epochs: 100,
        lr: 0.001,
        batch_size: 32,
        dataset: 'config-filter-dataset',
        optimizer: 'AdamW',
        checkpoint: { r2_prefix: 'checkpoints/run-37a9f2/step-1000' },
        trainer: { lr: 0.05 },
        model: { name: 'dit' },
      },
      systemMetadata: { hostname: 'config-filter-host', python: '3.11' },
      updatedAt: new Date(),
    });

    // Bulk create all runs at once
    await prisma.runs.createMany({
      data: bulkRunData,
      skipDuplicates: true,
    });

    // Fetch the created runs to get their IDs
    const createdBulkRuns = await prisma.runs.findMany({
      where: {
        projectId: project.id,
        organizationId: org.id,
        OR: [
          { name: { startsWith: 'bulk-run-' } },
          { name: { startsWith: 'a-bulk-run-' } },
          { name: { startsWith: 'a-running-run-' } },
        ],
      },
      select: { id: true, name: true, createdAt: true },
    });

    // Also fetch the needle run
    const needleRunCreated = await prisma.runs.findFirst({
      where: {
        projectId: project.id,
        organizationId: org.id,
        name: 'hidden-needle-experiment',
      },
      select: { id: true, name: true, createdAt: true },
    });

    if (needleRunCreated) {
      createdBulkRuns.push(needleRunCreated);
    }

    console.log(`   ✓ Created ${createdBulkRuns.length} bulk runs`);

    // Register metric names in PostgreSQL run_logs
    console.log(`   📝 Registering ${METRICS_PER_RUN} metrics per run in run_logs...`);
    const runLogData = createdBulkRuns.flatMap((run) =>
      Array.from({ length: METRICS_PER_RUN }, (_, i) => ({
        runId: run.id,
        logName: `train/metric_${String(i).padStart(2, '0')}`,
        logGroup: 'train',
        logType: 'METRIC' as const,
      }))
    );
    await prisma.runLogs.createMany({
      data: runLogData,
      skipDuplicates: true,
    });
    console.log(`   ✓ Registered ${runLogData.length} metric names in run_logs`);

    // Backfill ProjectColumnKey and RunFieldValue for config/systemMetadata columns
    console.log(`   📝 Backfilling column keys and field values...`);
    const allBulkRuns = await prisma.runs.findMany({
      where: { projectId: project.id, organizationId: org.id },
      select: { id: true, config: true, systemMetadata: true },
    });
    for (const run of allBulkRuns) {
      await extractAndUpsertColumnKeys(
        prisma,
        org.id,
        project.id,
        run.config,
        run.systemMetadata,
        run.id,
      );
    }
    console.log(`   ✓ Backfilled column keys for ${allBulkRuns.length} runs`);

    // Seed ClickHouse with metric datapoints
    await seedClickHouseMetrics(
      createdBulkRuns,
      org.id,
      project.name,
      METRICS_PER_RUN,
      DATAPOINTS_PER_METRIC,
    );

    // Seed NaN/Inf metrics for the nan-inf-metrics run (Test 24.2b)
    const nanInfRun = await prisma.runs.findFirst({
      where: {
        projectId: project.id,
        organizationId: org.id,
        name: 'nan-inf-metrics',
      },
      select: { id: true, name: true, createdAt: true },
    });

    if (nanInfRun) {
      // Register 14 train/* metric names in run_logs
      const nanInfMetricNames = [
        'loss', 'accuracy', 'lr', 'grad_norm', 'epoch_time',
        'precision', 'recall', 'f1', 'auc', 'perplexity',
        'gpu_util', 'memory_used', 'throughput', 'latency',
      ];
      const nanInfRunLogData = nanInfMetricNames.map((name) => ({
        runId: nanInfRun.id,
        logName: `train/${name}`,
        logGroup: 'train',
        logType: 'METRIC' as const,
      }));
      await prisma.runLogs.createMany({
        data: nanInfRunLogData,
        skipDuplicates: true,
      });
      console.log(`   ✓ Registered ${nanInfMetricNames.length} NaN/Inf metric names in run_logs`);

      // Insert NaN/Inf metric values via raw SQL
      await seedNanInfMetrics(nanInfRun.id, nanInfRun.createdAt, org.id, project.name);
    }

    // Seed nested gradient-norm metrics for the a-bulk-run-011..013 runs so
    // dynamic-section grouping E2E tests can target a realistic per-layer
    // metric tree (gradients/norms/<layer>/{min,max,mean,std}).
    const gradNormRuns = createdBulkRuns.filter((r) => r.name.startsWith('a-bulk-run-'));
    if (gradNormRuns.length > 0) {
      console.log(`   📝 Registering ${NESTED_GRAD_NORM_LAYERS.length * NESTED_GRAD_NORM_STATS.length} nested grad-norm metrics in run_logs...`);
      const gradNormLogData = gradNormRuns.flatMap((run) =>
        NESTED_GRAD_NORM_LAYERS.flatMap((layer) =>
          NESTED_GRAD_NORM_STATS.map((stat) => ({
            runId: run.id,
            logName: `gradients/norms/${layer}/${stat}`,
            logGroup: 'gradients/norms',
            logType: 'METRIC' as const,
          })),
        ),
      );
      await prisma.runLogs.createMany({ data: gradNormLogData, skipDuplicates: true });
      await seedNestedGradNormMetrics(gradNormRuns, org.id, project.name);

      // Blah eval metrics with TWO independently-varying segments —
      // exercises regex prefix grouping with multiple capture groups.
      const blahMetricCount = BLAH_HORIZONS.length * BLAH_VARIANTS.length * BLAH_METRICS.length;
      console.log(`   📝 Registering ${blahMetricCount} blah eval metrics in run_logs...`);
      const blahLogData = gradNormRuns.flatMap((run) =>
        BLAH_HORIZONS.flatMap((horizon) =>
          BLAH_VARIANTS.flatMap((variant) =>
            BLAH_METRICS.map((metric) => ({
              runId: run.id,
              logName: `validation/blah/${horizon}/${variant}/${metric}`,
              logGroup: 'validation/blah',
              logType: 'METRIC' as const,
            })),
          ),
        ),
      );
      await prisma.runLogs.createMany({ data: blahLogData, skipDuplicates: true });
      await seedBlahMetrics(gradNormRuns, org.id, project.name);
    }
  } else {
    console.log(`   ✓ Bulk runs already exist (found needle run)`);
  }

  // 5c. Create staircase-test run for zoom congruence E2E tests
  console.log('\n5️⃣c Creating staircase-test run...');

  let staircaseRun = await prisma.runs.findFirst({
    where: {
      projectId: project.id,
      organizationId: org.id,
      name: 'staircase-test',
    },
    select: { id: true, name: true, createdAt: true },
  });

  if (!staircaseRun) {
    // Set createdAt to the past so this run isn't auto-selected as one of the
    // newest runs — avoids interfering with existing tests that expect bulk-run data.
    const staircaseCreatedAt = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000); // 1 year ago
    staircaseRun = await prisma.runs.create({
      data: {
        name: 'staircase-test',
        organizationId: org.id,
        projectId: project.id,
        createdById: user.id,
        creatorApiKeyId: apiKey.id,
        status: 'COMPLETED',
        config: { epochs: 500, lr: 0.001 },
        systemMetadata: { hostname: 'test-host', python: '3.11' },
        createdAt: staircaseCreatedAt,
        updatedAt: staircaseCreatedAt,
      },
    });
    console.log(`   ✓ Created staircase-test run (ID: ${staircaseRun.id})`);

    // Register the metrics in runLogs
    await prisma.runLogs.createMany({
      data: [
        {
          runId: staircaseRun.id,
          logName: 'test/staircase',
          logGroup: 'test',
          logType: 'METRIC' as const,
        },
        {
          runId: staircaseRun.id,
          logName: 'test/staircase_irregular',
          logGroup: 'test',
          logType: 'METRIC' as const,
        },
      ],
      skipDuplicates: true,
    });
    console.log('   ✓ Registered test/staircase and test/staircase_irregular metrics in run_logs');

    // Seed ClickHouse with staircase metric: value = Math.floor(step / 50)
    // 500 datapoints, 1 second apart, creating 10 distinct levels (0-9)
    const clickhouseUrl = process.env.CLICKHOUSE_URL;
    const clickhouseUser = process.env.CLICKHOUSE_USER || 'default';
    const clickhousePassword = process.env.CLICKHOUSE_PASSWORD || '';

    if (clickhouseUrl) {
      const clickhouse = createClient({
        url: clickhouseUrl,
        username: clickhouseUser,
        password: clickhousePassword,
      });

      const STAIRCASE_STEPS = 500;
      const baseTime = staircaseRun.createdAt.getTime();
      const staircaseRows: Record<string, unknown>[] = [];

      for (let step = 0; step < STAIRCASE_STEPS; step++) {
        staircaseRows.push({
          tenantId: org.id,
          projectName: project.name,
          runId: Number(staircaseRun.id),
          logGroup: 'test',
          logName: 'test/staircase',
          time: new Date(baseTime + step * 1000).toISOString().replace('T', ' ').replace('Z', ''),
          step,
          value: Math.floor(step / 50),
        });
      }

      // Also seed an irregular-timing variant: same y-values but with variable
      // time gaps between steps. This tests the sourceStepRange fix — with
      // irregular spacing, step→time→step roundtrip produces wrong bounds.
      // Pattern: steps 0-249 are 1s apart, steps 250-499 are 10s apart.
      // This creates a 10x time density change at step 250.
      for (let step = 0; step < STAIRCASE_STEPS; step++) {
        const timeOffset = step < 250
          ? step * 1000                        // 0-249: 1s apart (250s total)
          : 250 * 1000 + (step - 250) * 10000; // 250-499: 10s apart (2500s total)
        staircaseRows.push({
          tenantId: org.id,
          projectName: project.name,
          runId: Number(staircaseRun.id),
          logGroup: 'test',
          logName: 'test/staircase_irregular',
          time: new Date(baseTime + timeOffset).toISOString().replace('T', ' ').replace('Z', ''),
          step,
          value: Math.floor(step / 50),
        });
      }

      await clickhouse.insert({
        table: 'mlop_metrics',
        values: staircaseRows,
        format: 'JSONEachRow',
      });
      console.log(`   ✓ Seeded ${STAIRCASE_STEPS * 2} staircase metric datapoints (regular + irregular)`);
      // Summaries populated by the end-of-setup SYSTEM REFRESH.

      await clickhouse.close();
    } else {
      console.log('   ⚠ CLICKHOUSE_URL not set, skipping staircase ClickHouse seeding');
    }
  } else {
    console.log(`   ✓ staircase-test run already exists (ID: ${staircaseRun.id})`);
  }

  // Ensure staircase run has a display ID (idempotent — safe to run on existing runs)
  if (staircaseRun && staircaseRun.id) {
    if (!project.runPrefix) {
      await prisma.projects.update({
        where: { id: project.id },
        data: { runPrefix: 'STP' },
      });
      (project as any).runPrefix = 'STP';
    }
    await prisma.runs.update({
      where: { id: staircaseRun.id },
      data: { number: 999 },
    });
    console.log(`   ✓ Ensured display ID: ${project.runPrefix}-999`);
  }

  // 5d. Create multi-metric-test run for single-run multi-metric tooltip E2E tests
  console.log('\n5️⃣d Creating multi-metric-test run...');

  const MULTI_METRIC_COUNT = 10;
  const MULTI_METRIC_STEPS = 100;

  let multiMetricRun = await prisma.runs.findFirst({
    where: {
      projectId: project.id,
      organizationId: org.id,
      name: 'multi-metric-test',
    },
    select: { id: true, name: true, createdAt: true },
  });

  if (!multiMetricRun) {
    const multiMetricCreatedAt = new Date(Date.now() - 363 * 24 * 60 * 60 * 1000); // ~1 year ago
    multiMetricRun = await prisma.runs.create({
      data: {
        name: 'multi-metric-test',
        organizationId: org.id,
        projectId: project.id,
        createdById: user.id,
        creatorApiKeyId: apiKey.id,
        status: 'COMPLETED',
        config: { metrics: MULTI_METRIC_COUNT, steps: MULTI_METRIC_STEPS },
        systemMetadata: { hostname: 'test-host', python: '3.11' },
        createdAt: multiMetricCreatedAt,
        updatedAt: multiMetricCreatedAt,
      },
    });
    console.log(`   ✓ Created multi-metric-test run (ID: ${multiMetricRun.id})`);

    // Register metrics in runLogs: stress/sine_0 .. stress/sine_9
    const multiMetricLogData = Array.from({ length: MULTI_METRIC_COUNT }, (_, i) => ({
      runId: multiMetricRun!.id,
      logName: `stress/sine_${i}`,
      logGroup: 'stress',
      logType: 'METRIC' as const,
    }));
    await prisma.runLogs.createMany({
      data: multiMetricLogData,
      skipDuplicates: true,
    });
    console.log(`   ✓ Registered ${MULTI_METRIC_COUNT} stress/sine_* metrics in run_logs`);

    // Seed ClickHouse with sine waves: value = sin(step/20 + idx * 2π/10)
    const clickhouseUrl = process.env.CLICKHOUSE_URL;
    const clickhouseUser = process.env.CLICKHOUSE_USER || 'default';
    const clickhousePassword = process.env.CLICKHOUSE_PASSWORD || '';

    if (clickhouseUrl) {
      const clickhouse = createClient({
        url: clickhouseUrl,
        username: clickhouseUser,
        password: clickhousePassword,
      });

      const baseTime = multiMetricRun.createdAt.getTime();
      const multiMetricRows: Record<string, unknown>[] = [];

      for (let metricIdx = 0; metricIdx < MULTI_METRIC_COUNT; metricIdx++) {
        for (let step = 0; step < MULTI_METRIC_STEPS; step++) {
          multiMetricRows.push({
            tenantId: org.id,
            projectName: project.name,
            runId: Number(multiMetricRun.id),
            logGroup: 'stress',
            logName: `stress/sine_${metricIdx}`,
            time: new Date(baseTime + step * 1000).toISOString().replace('T', ' ').replace('Z', ''),
            step,
            value: Math.sin(step / 20 + metricIdx * 2 * Math.PI / MULTI_METRIC_COUNT),
          });
        }
      }

      await clickhouse.insert({
        table: 'mlop_metrics',
        values: multiMetricRows,
        format: 'JSONEachRow',
      });
      console.log(`   ✓ Seeded ${multiMetricRows.length} multi-metric datapoints (${MULTI_METRIC_COUNT} metrics × ${MULTI_METRIC_STEPS} steps)`);
      // Summaries populated by the end-of-setup SYSTEM REFRESH.

      await clickhouse.close();
    } else {
      console.log('   ⚠ CLICKHOUSE_URL not set, skipping multi-metric ClickHouse seeding');
    }
  } else {
    console.log(`   ✓ multi-metric-test run already exists (ID: ${multiMetricRun.id})`);
  }

  // 5d-bis. Two runs with mismatched logging cadences for the tooltip
  // interpolation (~prefix) regression test. Both share metric `interp/loss`,
  // but interp-sparse-cadence only logs every 50 steps. With both selected,
  // the chart's union x-axis has nulls for the sparse run at off-cadence
  // positions — the tooltip must render those positions with the ~prefix and
  // italic+0.6 opacity styling. See:
  //   web/e2e/specs/charts/tooltip-interpolated-value.spec.ts
  console.log('\n5️⃣d-bis Creating tooltip-interpolation test runs...');

  const interpDense = await prisma.runs.findFirst({
    where: { projectId: project.id, organizationId: org.id, name: 'interp-dense-cadence' },
    select: { id: true, name: true, createdAt: true },
  });
  const interpSparse = await prisma.runs.findFirst({
    where: { projectId: project.id, organizationId: org.id, name: 'interp-sparse-cadence' },
    select: { id: true, name: true, createdAt: true },
  });

  if (!interpDense || !interpSparse) {
    // Far past so they don't auto-select on the project page (existing tests
    // pre-select via TEST_RUNS_ALL — these runs are opted into explicitly via
    // ?runs= URL params in the interpolation test only).
    const interpCreatedAt = new Date(Date.now() - 362 * 24 * 60 * 60 * 1000);
    const dense = interpDense ?? await prisma.runs.create({
      data: {
        name: 'interp-dense-cadence',
        organizationId: org.id,
        projectId: project.id,
        createdById: user.id,
        creatorApiKeyId: apiKey.id,
        status: 'COMPLETED',
        config: { cadence: 'every-1-step', steps: 1000 },
        systemMetadata: { hostname: 'test-host', python: '3.11' },
        createdAt: interpCreatedAt,
        updatedAt: interpCreatedAt,
      },
    });
    const sparse = interpSparse ?? await prisma.runs.create({
      data: {
        name: 'interp-sparse-cadence',
        organizationId: org.id,
        projectId: project.id,
        createdById: user.id,
        creatorApiKeyId: apiKey.id,
        status: 'COMPLETED',
        config: { cadence: 'every-50-steps', steps: 1000 },
        systemMetadata: { hostname: 'test-host', python: '3.11' },
        createdAt: new Date(interpCreatedAt.getTime() + 1000),
        updatedAt: new Date(interpCreatedAt.getTime() + 1000),
      },
    });
    console.log(`   ✓ Created interp runs (dense ID=${dense.id}, sparse ID=${sparse.id})`);

    // Register metric registry rows
    await prisma.runLogs.createMany({
      data: [
        { runId: dense.id, logName: 'interp/loss', logGroup: 'interp', logType: 'METRIC' as const },
        { runId: sparse.id, logName: 'interp/loss', logGroup: 'interp', logType: 'METRIC' as const },
      ],
      skipDuplicates: true,
    });

    const clickhouseUrl = process.env.CLICKHOUSE_URL;
    const clickhouseUser = process.env.CLICKHOUSE_USER || 'default';
    const clickhousePassword = process.env.CLICKHOUSE_PASSWORD || '';
    if (clickhouseUrl) {
      const clickhouse = createClient({
        url: clickhouseUrl,
        username: clickhouseUser,
        password: clickhousePassword,
      });

      const interpRows: Record<string, unknown>[] = [];
      // Dense — every step 0..999
      const denseBase = dense.createdAt.getTime();
      for (let step = 0; step < 1000; step++) {
        interpRows.push({
          tenantId: org.id,
          projectName: project.name,
          runId: Number(dense.id),
          logGroup: 'interp',
          logName: 'interp/loss',
          time: new Date(denseBase + step * 1000).toISOString().replace('T', ' ').replace('Z', ''),
          step,
          value: 2 * Math.exp(-step / 200) + 0.05,
        });
      }
      // Sparse — every 50 steps, 0, 50, 100, ..., 950 (20 points)
      const sparseBase = sparse.createdAt.getTime();
      for (let step = 0; step < 1000; step += 50) {
        interpRows.push({
          tenantId: org.id,
          projectName: project.name,
          runId: Number(sparse.id),
          logGroup: 'interp',
          logName: 'interp/loss',
          time: new Date(sparseBase + step * 1000).toISOString().replace('T', ' ').replace('Z', ''),
          step,
          value: 1.5 * Math.exp(-step / 250) + 0.1,
        });
      }

      await clickhouse.insert({
        table: 'mlop_metrics',
        values: interpRows,
        format: 'JSONEachRow',
      });
      console.log(`   ✓ Seeded ${interpRows.length} interp/loss rows (1000 dense + 20 sparse)`);

      // Populate metric summaries for both runs so the metric appears in
      // the project's chart group listing.
      for (const run of [dense, sparse]) {
        await clickhouse.command({
          query: `
            INSERT INTO mlop_metric_summaries
            SELECT tenantId, projectName, runId, logName,
              min(value), max(value), sum(value),
              toUInt64(count()), argMaxState(value, step),
              sum(value * value), min(step), max(step)
            FROM mlop_metrics
            WHERE tenantId = {tenantId: String}
              AND projectName = {projectName: String}
              AND runId = {runId: UInt64}
              AND isFinite(value)
            GROUP BY tenantId, projectName, runId, logName
          `,
          query_params: {
            tenantId: org.id,
            projectName: project.name,
            runId: Number(run.id),
          },
        });
      }
      console.log('   ✓ Populated metric summaries for interp runs');
      await clickhouse.close();
    } else {
      console.log('   ⚠ CLICKHOUSE_URL not set, skipping interp run ClickHouse seeding');
    }
  } else {
    console.log(`   ✓ interp-{dense,sparse}-cadence runs already exist`);
  }

  // 5e. Create zoom-visibility test runs (different step counts) for hidden-run zoom reset E2E test
  console.log('\n5️⃣e Creating zoom-visibility test runs...');

  const zoomVisShort = await prisma.runs.findFirst({
    where: { projectId: project.id, organizationId: org.id, name: 'zoom-visibility-short' },
    select: { id: true, name: true, createdAt: true },
  });

  if (!zoomVisShort) {
    // Created in the past to avoid auto-select interference
    const zoomVisCreatedAt = new Date(Date.now() - 364 * 24 * 60 * 60 * 1000);

    const shortRun = await prisma.runs.create({
      data: {
        name: 'zoom-visibility-short',
        organizationId: org.id,
        projectId: project.id,
        createdById: user.id,
        creatorApiKeyId: apiKey.id,
        status: 'COMPLETED',
        config: { epochs: 200, lr: 0.001 },
        systemMetadata: { hostname: 'test-host', python: '3.11' },
        createdAt: zoomVisCreatedAt,
        updatedAt: zoomVisCreatedAt,
      },
    });

    const longRun = await prisma.runs.create({
      data: {
        name: 'zoom-visibility-long',
        organizationId: org.id,
        projectId: project.id,
        createdById: user.id,
        creatorApiKeyId: apiKey.id,
        status: 'COMPLETED',
        config: { epochs: 1000, lr: 0.001 },
        systemMetadata: { hostname: 'test-host', python: '3.11' },
        createdAt: new Date(zoomVisCreatedAt.getTime() + 1000),
        updatedAt: new Date(zoomVisCreatedAt.getTime() + 1000),
      },
    });

    // Register metrics in RunLogs
    const metricName = 'train/loss';
    await prisma.runLogs.createMany({
      data: [
        { runId: shortRun.id, logName: metricName, logGroup: 'train', logType: 'METRIC' as const },
        { runId: longRun.id, logName: metricName, logGroup: 'train', logType: 'METRIC' as const },
      ],
      skipDuplicates: true,
    });

    // Seed ClickHouse: short run = 200 steps, long run = 1000 steps
    const clickhouseUrl = process.env.CLICKHOUSE_URL;
    const clickhouseUser = process.env.CLICKHOUSE_USER || 'default';
    const clickhousePassword = process.env.CLICKHOUSE_PASSWORD || '';

    if (clickhouseUrl) {
      const clickhouse = createClient({
        url: clickhouseUrl,
        username: clickhouseUser,
        password: clickhousePassword,
      });

      const rows: Record<string, unknown>[] = [];

      // Short run: 200 steps
      const shortBase = shortRun.createdAt.getTime();
      for (let step = 0; step < 200; step++) {
        rows.push({
          tenantId: org.id,
          projectName: project.name,
          runId: Number(shortRun.id),
          logGroup: 'train',
          logName: metricName,
          time: new Date(shortBase + step * 1000).toISOString().replace('T', ' ').replace('Z', ''),
          step,
          value: Math.exp(-step / 100) * 2 + Math.random() * 0.1,
        });
      }

      // Long run: 1000 steps
      const longBase = longRun.createdAt.getTime();
      for (let step = 0; step < 1000; step++) {
        rows.push({
          tenantId: org.id,
          projectName: project.name,
          runId: Number(longRun.id),
          logGroup: 'train',
          logName: metricName,
          time: new Date(longBase + step * 1000).toISOString().replace('T', ' ').replace('Z', ''),
          step,
          value: Math.exp(-step / 200) * 2 + Math.random() * 0.1,
        });
      }

      await clickhouse.insert({
        table: 'mlop_metrics',
        values: rows,
        format: 'JSONEachRow',
      });
      console.log(`   ✓ Seeded ${rows.length} zoom-visibility metric datapoints (200 + 1000)`);
      // Summaries populated by the end-of-setup SYSTEM REFRESH.

      await clickhouse.close();
    }

    console.log(`   ✓ Created zoom-visibility-short (ID: ${shortRun.id}) and zoom-visibility-long (ID: ${longRun.id})`);
  } else {
    console.log('   ✓ zoom-visibility runs already exist');
  }

  // 5e2. grouping-chart-test — deterministic FLAT-LINE runs (constant y,
  // no noise) so grouped-chart band aggregates are analytically exact and
  // e2e can assert real numbers. Grouped by `tag-prefix:group`:
  //   group a = runs at y {2,4,6}  -> mean 4,  band [2,6]
  //   group b = runs at y {10,20}  -> mean 15, band [10,20]
  // Subgrouped by `config:batch_size`: a/bs16 = {4,6} -> mean 5, band [4,6].
  // Hiding gc-a3 (y=6) -> group a becomes {2,4} -> mean 3, band [2,4].
  console.log('\n5️⃣e2 Creating grouping-chart-test runs...');
  const groupingChartProject = await prisma.projects.upsert({
    where: {
      organizationId_name: { organizationId: org.id, name: 'grouping-chart-test' },
    },
    create: { name: 'grouping-chart-test', organizationId: org.id },
    update: {},
  });

  const gcExisting = await prisma.runs.findFirst({
    where: { projectId: groupingChartProject.id, organizationId: org.id, name: 'gc-a1' },
    select: { id: true },
  });

  if (!gcExisting) {
    const gcSeed = [
      { name: 'gc-a1', group: 'a', batchSize: 8, y: 2 },
      { name: 'gc-a2', group: 'a', batchSize: 16, y: 4 },
      { name: 'gc-a3', group: 'a', batchSize: 16, y: 6 },
      { name: 'gc-b1', group: 'b', batchSize: 8, y: 10 },
      { name: 'gc-b2', group: 'b', batchSize: 16, y: 20 },
    ];
    const GC_STEPS = 20;
    const GC_METRICS = ['train/loss', 'train/accuracy'];
    // Created ~363 days in the past so auto-select doesn't grab them.
    const gcBase = new Date(Date.now() - 363 * 24 * 60 * 60 * 1000);

    const gcRuns: { id: bigint; y: number; createdAt: Date }[] = [];
    for (let i = 0; i < gcSeed.length; i++) {
      const s = gcSeed[i];
      const createdAt = new Date(gcBase.getTime() + i * 1000);
      const run = await prisma.runs.create({
        data: {
          name: s.name,
          organizationId: org.id,
          projectId: groupingChartProject.id,
          createdById: user.id,
          creatorApiKeyId: apiKey.id,
          status: 'COMPLETED',
          tags: [`group:${s.group}`],
          config: { batch_size: s.batchSize },
          systemMetadata: { hostname: 'gc-host', python: '3.11' },
          createdAt,
          updatedAt: createdAt,
        },
      });
      gcRuns.push({ id: run.id, y: s.y, createdAt });
      // Backfill so `config:batch_size` is groupable/filterable server-side.
      await extractAndUpsertColumnKeys(
        prisma,
        org.id,
        groupingChartProject.id,
        { batch_size: s.batchSize },
        { hostname: 'gc-host', python: '3.11' },
        run.id,
      );
    }

    await prisma.runLogs.createMany({
      data: gcRuns.flatMap((r) =>
        GC_METRICS.map((logName) => ({
          runId: r.id,
          logName,
          logGroup: 'train',
          logType: 'METRIC' as const,
        })),
      ),
      skipDuplicates: true,
    });

    const gcClickhouseUrl = process.env.CLICKHOUSE_URL;
    if (gcClickhouseUrl) {
      const gcClickhouse = createClient({
        url: gcClickhouseUrl,
        username: process.env.CLICKHOUSE_USER || 'default',
        password: process.env.CLICKHOUSE_PASSWORD || '',
      });
      const gcRows: Record<string, unknown>[] = [];
      for (const r of gcRuns) {
        const base = r.createdAt.getTime();
        for (const logName of GC_METRICS) {
          for (let step = 0; step < GC_STEPS; step++) {
            gcRows.push({
              tenantId: org.id,
              projectName: groupingChartProject.name,
              runId: Number(r.id),
              logGroup: 'train',
              logName,
              time: new Date(base + step * 1000).toISOString().replace('T', ' ').replace('Z', ''),
              step,
              value: r.y, // FLAT, no noise -> exact per-step band mean/min/max.
            });
          }
        }
      }
      await gcClickhouse.insert({ table: 'mlop_metrics', values: gcRows, format: 'JSONEachRow' });
      await gcClickhouse.close();
      console.log(`   ✓ Seeded ${gcRows.length} grouping-chart-test datapoints (flat lines)`);
    }
    console.log(`   ✓ Created grouping-chart-test with ${gcRuns.length} flat-line runs`);
  } else {
    console.log('   ✓ grouping-chart-test runs already exist');
  }

  // 5e2b. "Grouped Multi-Metric Test" dashboard on grouping-chart-test — one
  // static widget charting BOTH metrics (train/loss + train/accuracy). Grouped,
  // this renders 2 groups × 2 metrics; the fix under test gives each metric a
  // distinct dash (color = group, dash = metric).
  const groupedMultiMetricConfig = {
    version: 1,
    sections: [
      {
        id: 'section-mm',
        name: 'Multi-Metric',
        collapsed: false,
        widgets: [
          {
            id: 'widget-mm-loss-acc',
            type: 'chart',
            config: {
              metrics: ['train/loss', 'train/accuracy'],
              xAxis: 'step',
              yAxisScale: 'linear',
              xAxisScale: 'linear',
              aggregation: 'LAST',
              showOriginal: false,
            },
            layout: { x: 0, y: 0, w: 12, h: 4 },
          },
        ],
      },
    ],
    settings: { gridCols: 12, rowHeight: 80, compactType: 'vertical' },
  };
  await prisma.dashboardView.upsert({
    where: {
      organizationId_projectId_name: {
        organizationId: org.id,
        projectId: groupingChartProject.id,
        name: 'Grouped Multi-Metric Test',
      },
    },
    update: { config: groupedMultiMetricConfig },
    create: {
      name: 'Grouped Multi-Metric Test',
      organizationId: org.id,
      projectId: groupingChartProject.id,
      createdById: user.id,
      isDefault: false,
      config: groupedMultiMetricConfig,
    },
  });
  console.log('   ✓ Created Grouped Multi-Metric Test dashboard view');

  // 5e3. grouping-scale-test — 22 runs, all under tag group:big, each with a
  // distinct name and a distinct config.sub. Serves all three pagination layers,
  // table-only (no metrics):
  //   - leaf runs: group by Group → 1 bucket, 22 runs → "01-10 of 22"
  //   - top-level footer: group by Name → 22 name-groups > DEFAULT_PAGE_SIZE 20
  //     → 2 pages
  //   - nested subgroups: group by Group → config:sub → 22 subgroups → inline
  //     "01-10 of 22"
  console.log('\n5️⃣e3 Creating grouping-scale-test runs...');
  const groupingScaleProject = await prisma.projects.upsert({
    where: {
      organizationId_name: { organizationId: org.id, name: 'grouping-scale-test' },
    },
    create: { name: 'grouping-scale-test', organizationId: org.id },
    update: {},
  });
  const gsExisting = await prisma.runs.findFirst({
    where: { projectId: groupingScaleProject.id, organizationId: org.id, name: 'gs-00' },
    select: { id: true },
  });
  if (!gsExisting) {
    const gsBase = new Date(Date.now() - 362 * 24 * 60 * 60 * 1000);
    await prisma.runs.createMany({
      data: Array.from({ length: 22 }, (_, i) => ({
        name: `gs-${String(i).padStart(2, '0')}`,
        tags: ['group:big'],
        config: { sub: `s${String(i).padStart(2, '0')}` },
        organizationId: org.id,
        projectId: groupingScaleProject.id,
        createdById: user.id,
        creatorApiKeyId: apiKey.id,
        status: 'COMPLETED' as const,
        createdAt: new Date(gsBase.getTime() + i * 1000),
        updatedAt: new Date(gsBase.getTime() + i * 1000),
      })),
      skipDuplicates: true,
    });
    // Backfill config.sub so it's groupable server-side (nested subgroups).
    const gsRuns = await prisma.runs.findMany({
      where: { projectId: groupingScaleProject.id, organizationId: org.id },
      select: { id: true, config: true, systemMetadata: true },
    });
    for (const gsRun of gsRuns) {
      await extractAndUpsertColumnKeys(
        prisma,
        org.id,
        groupingScaleProject.id,
        gsRun.config,
        gsRun.systemMetadata,
        gsRun.id,
      );
    }
    console.log('   ✓ Created grouping-scale-test with 22 runs (group:big, distinct config.sub)');
  } else {
    console.log('   ✓ grouping-scale-test runs already exist');
  }

  // 5e4. grouping-many-test — 12 single-run groups (group:g00..g11), each with a
  // flat train/loss line, so grouping by Group produces 12 chart series and the
  // 10-group cap (grouped-line-chart.tsx: effectiveMaxGroups = maxGroups ?? 10)
  // triggers the "Showing 10 of ... 12 total selected groups" truncation banner.
  console.log('\n5️⃣e4 Creating grouping-many-test runs...');
  const groupingManyProject = await prisma.projects.upsert({
    where: {
      organizationId_name: { organizationId: org.id, name: 'grouping-many-test' },
    },
    create: { name: 'grouping-many-test', organizationId: org.id },
    update: {},
  });
  const gmExisting = await prisma.runs.findFirst({
    where: { projectId: groupingManyProject.id, organizationId: org.id, name: 'mm-00' },
    select: { id: true },
  });
  if (!gmExisting) {
    const GM_STEPS = 15;
    const gmBase = new Date(Date.now() - 361 * 24 * 60 * 60 * 1000);
    const gmRuns: { id: bigint; y: number; createdAt: Date }[] = [];
    for (let i = 0; i < 12; i++) {
      const createdAt = new Date(gmBase.getTime() + i * 1000);
      const run = await prisma.runs.create({
        data: {
          name: `mm-${String(i).padStart(2, '0')}`,
          organizationId: org.id,
          projectId: groupingManyProject.id,
          createdById: user.id,
          creatorApiKeyId: apiKey.id,
          status: 'COMPLETED',
          tags: [`group:g${String(i).padStart(2, '0')}`],
          createdAt,
          updatedAt: createdAt,
        },
      });
      gmRuns.push({ id: run.id, y: i + 1, createdAt });
    }
    await prisma.runLogs.createMany({
      data: gmRuns.map((r) => ({
        runId: r.id,
        logName: 'train/loss',
        logGroup: 'train',
        logType: 'METRIC' as const,
      })),
      skipDuplicates: true,
    });
    const gmChUrl = process.env.CLICKHOUSE_URL;
    if (gmChUrl) {
      const gmCh = createClient({
        url: gmChUrl,
        username: process.env.CLICKHOUSE_USER || 'default',
        password: process.env.CLICKHOUSE_PASSWORD || '',
      });
      const gmRows: Record<string, unknown>[] = [];
      for (const r of gmRuns) {
        const base = r.createdAt.getTime();
        for (let step = 0; step < GM_STEPS; step++) {
          gmRows.push({
            tenantId: org.id,
            projectName: groupingManyProject.name,
            runId: Number(r.id),
            logGroup: 'train',
            logName: 'train/loss',
            time: new Date(base + step * 1000).toISOString().replace('T', ' ').replace('Z', ''),
            step,
            value: r.y,
          });
        }
      }
      await gmCh.insert({ table: 'mlop_metrics', values: gmRows, format: 'JSONEachRow' });
      await gmCh.close();
      console.log(`   ✓ Seeded ${gmRows.length} grouping-many-test datapoints (12 groups)`);
    }
    console.log('   ✓ Created grouping-many-test with 12 single-run groups');
  } else {
    console.log('   ✓ grouping-many-test runs already exist');
  }

  // 5f. Create pin-test runs with deterministic train/loss curves + images
  // at specific steps — used by image-pinning E2E tests for argmin/argmax
  // and "with image" variants. Each run has:
  // - train/loss with quadratic curve (clear argmin/argmax)
  // - images/training_viz and images/attention_maps at specific steps
  // - the argmin step for the metric does NOT have an image, so the
  //   "with image" variant picks a different step
  console.log('\n5️⃣f Creating pin-test runs...');

  const existingPinTestRuns = await prisma.runs.findMany({
    where: {
      projectId: project.id,
      organizationId: org.id,
      name: { in: ['pin-test-run-A', 'pin-test-run-B', 'pin-test-run-C'] },
    },
    select: { id: true, name: true, createdAt: true },
  });

  // Deterministic test data for pin tests.
  // Each run has a quadratic loss curve with a different minimum.
  const pinTestRunConfigs = [
    {
      name: 'pin-test-run-A',
      lossMinStep: 20,
      trainingVizSteps: [0, 25, 50, 75, 100],
      attentionMapsSteps: [0, 30, 60, 90],
    },
    {
      name: 'pin-test-run-B',
      lossMinStep: 50,
      trainingVizSteps: [0, 10, 45, 80, 100],
      attentionMapsSteps: [0, 15, 55, 70, 100],
    },
    {
      name: 'pin-test-run-C',
      lossMinStep: 70,
      trainingVizSteps: [0, 25, 65, 85, 100],
      attentionMapsSteps: [0, 35, 75, 90, 100],
    },
  ];

  // Create any missing pin-test runs
  const pinTestCreatedAt = new Date(Date.now() - 362 * 24 * 60 * 60 * 1000);
  const existingByName = new Map(existingPinTestRuns.map((r) => [r.name, r]));
  const createdPinTestRuns: { id: bigint; name: string; createdAt: Date; lossMinStep: number; trainingVizSteps: number[]; attentionMapsSteps: number[] }[] = [];
  for (let i = 0; i < pinTestRunConfigs.length; i++) {
    const cfg = pinTestRunConfigs[i];
    let run = existingByName.get(cfg.name);
    if (!run) {
      run = await prisma.runs.create({
        data: {
          name: cfg.name,
          organizationId: org.id,
          projectId: project.id,
          createdById: user.id,
          creatorApiKeyId: apiKey.id,
          status: 'COMPLETED',
          createdAt: new Date(pinTestCreatedAt.getTime() + i * 1000),
          updatedAt: new Date(pinTestCreatedAt.getTime() + i * 1000),
        },
      });
    }
    createdPinTestRuns.push({ ...run, ...cfg });
  }

  // Always re-register logs (no-op on duplicates)
  await prisma.runLogs.createMany({
    data: createdPinTestRuns.flatMap((run) => [
      { runId: run.id, logName: 'train/loss', logGroup: 'train', logType: 'METRIC' as const },
      { runId: run.id, logName: 'images/training_viz', logGroup: 'images', logType: 'IMAGE' as const },
      { runId: run.id, logName: 'images/attention_maps', logGroup: 'images', logType: 'IMAGE' as const },
      // Video + audio mirrors of the two image widgets, at the SAME steps, so
      // the per-widget "with media" argmin pin snaps to the same per-widget
      // steps for video/audio as for images (media-best-step-pinning E2E).
      { runId: run.id, logName: 'video/training_viz', logGroup: 'video', logType: 'VIDEO' as const },
      { runId: run.id, logName: 'video/attention_maps', logGroup: 'video', logType: 'VIDEO' as const },
      { runId: run.id, logName: 'audio/training_viz', logGroup: 'audio', logType: 'AUDIO' as const },
      { runId: run.id, logName: 'audio/attention_maps', logGroup: 'audio', logType: 'AUDIO' as const },
    ]),
    skipDuplicates: true,
  });

  // Seed ClickHouse + S3 (mirrors the a-bulk-run-011..013 media-rich
  // seeding pattern — always re-seeds on every setup run).
  const pinTestClickhouseUrl = process.env.CLICKHOUSE_URL;
  const pinTestStorageEndpoint = process.env.STORAGE_ENDPOINT;
  const pinTestStorageAccessKey = process.env.STORAGE_ACCESS_KEY_ID;
  const pinTestStorageSecretKey = process.env.STORAGE_SECRET_ACCESS_KEY;
  const pinTestStorageBucket = process.env.STORAGE_BUCKET;

  if (
    pinTestClickhouseUrl &&
    pinTestStorageEndpoint &&
    pinTestStorageAccessKey &&
    pinTestStorageSecretKey &&
    pinTestStorageBucket
  ) {
    const pinTestS3 = new S3Client({
      endpoint: pinTestStorageEndpoint,
      region: process.env.STORAGE_REGION || 'us-east-1',
      credentials: {
        accessKeyId: pinTestStorageAccessKey,
        secretAccessKey: pinTestStorageSecretKey,
      },
      forcePathStyle: true,
    });

    const pinTestCh = createClient({
      url: pinTestClickhouseUrl,
      username: process.env.CLICKHOUSE_USER || 'default',
      password: process.env.CLICKHOUSE_PASSWORD || '',
    });

    // --- train/loss metric (quadratic curve) ---
    const metricRows: Record<string, unknown>[] = [];
    for (const run of createdPinTestRuns) {
      const baseTime = run.createdAt.getTime();
      for (let step = 0; step <= 100; step++) {
        const loss = 0.1 + Math.pow(step - run.lossMinStep, 2) / 200;
        metricRows.push({
          tenantId: org.id,
          projectName: project.name,
          runId: Number(run.id),
          logGroup: 'train',
          logName: 'train/loss',
          time: new Date(baseTime + step * 1000).toISOString().replace('T', ' ').replace('Z', ''),
          step,
          value: loss,
        });
      }
    }
    if (metricRows.length > 0) {
      // Disable async insert + wait for commit so the mirror MV
      // (mlop_metrics_v2_mv) propagates these rows to mlop_metrics_v2 before
      // setupTestData's end-of-setup SYSTEM REFRESH reads from v2 FINAL.
      await pinTestCh.insert({
        table: 'mlop_metrics',
        values: metricRows,
        format: 'JSONEachRow',
        clickhouse_settings: {
          async_insert: 0,
          wait_for_async_insert: 1,
        },
      });
      console.log(`   ✓ Inserted ${metricRows.length} pin-test train/loss rows`);

      // Belt-and-suspenders: force any in-flight async inserts to flush so
      // they're committed before the end-of-setup SYSTEM REFRESH runs.
      await pinTestCh.command({ query: 'SYSTEM FLUSH ASYNC INSERT QUEUE' });
      // Summaries populated by the end-of-setup SYSTEM REFRESH.
    }

    // --- image files at deterministic steps ---
    const imageFileRows: Record<string, unknown>[] = [];
    const pinTestS3Uploads: Promise<unknown>[] = [];
    for (const run of createdPinTestRuns) {
      const baseTime = run.createdAt.getTime();
      const logConfigs = [
        { logName: 'images/training_viz', steps: run.trainingVizSteps },
        { logName: 'images/attention_maps', steps: run.attentionMapsSteps },
      ];
      for (const { logName, steps } of logConfigs) {
        for (const step of steps) {
          const fileName = `step_${String(step).padStart(4, '0')}.png`;
          const r = (step * 2) % 256;
          const g = logName.includes('training') ? 100 : 200;
          const b = (step * 3 + 50) % 256;
          const png = createSimplePNG(16, 16, r, g, b);
          const s3Key = `${org.id}/${project.name}/${run.id}/${logName}/${fileName}`;
          imageFileRows.push({
            tenantId: org.id,
            projectName: project.name,
            runId: Number(run.id),
            logGroup: 'images',
            logName,
            time: new Date(baseTime + step * 1000).toISOString().replace('T', ' ').replace('Z', ''),
            step,
            fileName,
            fileType: 'image/png',
            fileSize: png.length,
          });
          pinTestS3Uploads.push(
            pinTestS3.send(new PutObjectCommand({
              Bucket: pinTestStorageBucket,
              Key: s3Key,
              Body: png,
              ContentType: 'image/png',
            })),
          );
        }
      }
    }
    if (imageFileRows.length > 0) {
      await pinTestCh.insert({
        table: 'mlop_files',
        values: imageFileRows,
        format: 'JSONEachRow',
      });
      console.log(`   ✓ Inserted ${imageFileRows.length} pin-test image file rows`);
    }
    if (pinTestS3Uploads.length > 0) {
      await Promise.all(pinTestS3Uploads);
      console.log(`   ✓ Uploaded ${pinTestS3Uploads.length} pin-test PNGs to S3`);
    }

    // --- video + audio media at the SAME deterministic steps as the image
    // widgets. Reusing trainingVizSteps/attentionMapsSteps means the per-widget
    // "with media" argmin snaps to the same per-widget steps (PIN_TEST_EXPECTED)
    // for video/audio as for images — proving the media-coupled pin works
    // beyond images. Stub bytes: a valid silent WAV and a minimal ftyp+mdat MP4
    // (won't play, but the media viewer + pin badge still render).
    function makePinTestWav(): Buffer {
      const sampleRate = 16000;
      const numSamples = Math.floor(sampleRate * 0.05);
      const dataSize = numSamples * 2;
      const buf = Buffer.alloc(44 + dataSize);
      buf.write('RIFF', 0);
      buf.writeUInt32LE(36 + dataSize, 4);
      buf.write('WAVE', 8);
      buf.write('fmt ', 12);
      buf.writeUInt32LE(16, 16);
      buf.writeUInt16LE(1, 20);
      buf.writeUInt16LE(1, 22);
      buf.writeUInt32LE(sampleRate, 24);
      buf.writeUInt32LE(sampleRate * 2, 28);
      buf.writeUInt16LE(2, 32);
      buf.writeUInt16LE(16, 34);
      buf.write('data', 36);
      buf.writeUInt32LE(dataSize, 40);
      return buf;
    }
    function makePinTestMp4(): Buffer {
      const ftyp = Buffer.from([
        0x00, 0x00, 0x00, 0x14, 0x66, 0x74, 0x79, 0x70,
        0x69, 0x73, 0x6f, 0x6d, 0x00, 0x00, 0x02, 0x00,
        0x69, 0x73, 0x6f, 0x6d,
      ]);
      const mdat = Buffer.alloc(8);
      mdat.writeUInt32BE(8, 0);
      mdat.write('mdat', 4);
      return Buffer.concat([ftyp, mdat]);
    }

    const avFileRows: Record<string, unknown>[] = [];
    const avS3Uploads: Promise<unknown>[] = [];
    const pinTestWav = makePinTestWav();
    const pinTestMp4 = makePinTestMp4();
    for (const run of createdPinTestRuns) {
      const baseTime = run.createdAt.getTime();
      const avConfigs = [
        { logName: 'video/training_viz', logGroup: 'video', steps: run.trainingVizSteps, ext: 'mp4', fileType: 'video/mp4', bytes: pinTestMp4 },
        { logName: 'video/attention_maps', logGroup: 'video', steps: run.attentionMapsSteps, ext: 'mp4', fileType: 'video/mp4', bytes: pinTestMp4 },
        { logName: 'audio/training_viz', logGroup: 'audio', steps: run.trainingVizSteps, ext: 'wav', fileType: 'audio/wav', bytes: pinTestWav },
        { logName: 'audio/attention_maps', logGroup: 'audio', steps: run.attentionMapsSteps, ext: 'wav', fileType: 'audio/wav', bytes: pinTestWav },
      ];
      for (const { logName, logGroup, steps, ext, fileType, bytes } of avConfigs) {
        for (const step of steps) {
          const fileName = `step_${String(step).padStart(4, '0')}.${ext}`;
          const s3Key = `${org.id}/${project.name}/${run.id}/${logName}/${fileName}`;
          avFileRows.push({
            tenantId: org.id,
            projectName: project.name,
            runId: Number(run.id),
            logGroup,
            logName,
            time: new Date(baseTime + step * 1000).toISOString().replace('T', ' ').replace('Z', ''),
            step,
            fileName,
            fileType,
            fileSize: bytes.length,
          });
          avS3Uploads.push(
            pinTestS3.send(new PutObjectCommand({
              Bucket: pinTestStorageBucket,
              Key: s3Key,
              Body: bytes,
              ContentType: fileType,
            })),
          );
        }
      }
    }
    if (avFileRows.length > 0) {
      await pinTestCh.insert({ table: 'mlop_files', values: avFileRows, format: 'JSONEachRow' });
      console.log(`   ✓ Inserted ${avFileRows.length} pin-test video/audio file rows`);
    }
    if (avS3Uploads.length > 0) {
      await Promise.all(avS3Uploads);
      console.log(`   ✓ Uploaded ${avS3Uploads.length} pin-test video/audio files to S3`);
    }

    // mlop_metric_summaries population is handled by the end-of-setup
    // SYSTEM REFRESH (refreshMetricSummariesAndWait). The previous diagnostic
    // verification that lived here ran BEFORE the refresh, so it would have
    // erroneously failed under the new flow.

    await pinTestCh.close();
  } else {
    console.log('   ⚠ Missing CLICKHOUSE_URL or STORAGE_* env vars, skipping pin-test seeding');
  }

  console.log(`   ✓ Ensured ${createdPinTestRuns.length} pin-test runs are seeded`);

  // 5f.2. Best-step tolerance fixtures. Two runs exercise the nearest-snap
  // + K cap algorithm used by "pin to best step (with image)":
  //
  //   tol-test-run-offset — offset-cadence pattern: metric at steps
  //   {0,10,...,100} and image at steps {5,15,...,95}. They never overlap
  //   but are always exactly 5 steps apart. Parabolic loss centered at
  //   step 50 (min value 0.1). Nearest-snap with default K=20 should pick
  //   metricStep=50 and imageStep=55 (tie between 45 and 55, tie-break
  //   prefers later step).
  //
  //   tol-test-run-hard — global argmin far from any image. Metric absolute
  //   min at step 500 with no nearby image; second-smallest metric at step
  //   1002 right next to an image. Images at {0, 1000, 1001, 1003}. With
  //   K=20 the argmin (step 500, dist 500) is filtered out, step 1002
  //   qualifies (nearest images at 1001 and 1003, tie-break → 1003).
  console.log('\n5️⃣f² Creating best-step-tolerance fixture runs...');

  const tolRunConfigs = [
    { name: 'tol-test-run-offset', kind: 'offset' as const },
    { name: 'tol-test-run-hard', kind: 'hard' as const },
  ];
  const tolCreatedAt = new Date(Date.now() - 361 * 24 * 60 * 60 * 1000);
  const existingTolRuns = await prisma.runs.findMany({
    where: {
      projectId: project.id,
      organizationId: org.id,
      name: { in: tolRunConfigs.map((c) => c.name) },
    },
    select: { id: true, name: true, createdAt: true },
  });
  const existingTolByName = new Map(existingTolRuns.map((r) => [r.name, r]));
  const tolRuns: { id: bigint; name: string; kind: 'offset' | 'hard' }[] = [];
  for (let i = 0; i < tolRunConfigs.length; i++) {
    const cfg = tolRunConfigs[i];
    let run = existingTolByName.get(cfg.name);
    if (!run) {
      run = await prisma.runs.create({
        data: {
          name: cfg.name,
          organizationId: org.id,
          projectId: project.id,
          createdById: user.id,
          creatorApiKeyId: apiKey.id,
          status: 'COMPLETED',
          createdAt: new Date(tolCreatedAt.getTime() + i * 1000),
          updatedAt: new Date(tolCreatedAt.getTime() + i * 1000),
        },
      });
    }
    tolRuns.push({ id: run.id, name: cfg.name, kind: cfg.kind });
  }

  await prisma.runLogs.createMany({
    data: tolRuns.flatMap((run) => [
      { runId: run.id, logName: 'train/loss', logGroup: 'train', logType: 'METRIC' as const },
      { runId: run.id, logName: 'images/samples', logGroup: 'images', logType: 'IMAGE' as const },
    ]),
    skipDuplicates: true,
  });

  if (
    pinTestClickhouseUrl &&
    pinTestStorageEndpoint &&
    pinTestStorageAccessKey &&
    pinTestStorageSecretKey &&
    pinTestStorageBucket
  ) {
    const tolCh = createClient({
      url: pinTestClickhouseUrl,
      username: process.env.CLICKHOUSE_USER || 'default',
      password: process.env.CLICKHOUSE_PASSWORD || '',
    });
    const tolS3 = new S3Client({
      endpoint: pinTestStorageEndpoint,
      region: process.env.STORAGE_REGION || 'us-east-1',
      credentials: {
        accessKeyId: pinTestStorageAccessKey,
        secretAccessKey: pinTestStorageSecretKey,
      },
      forcePathStyle: true,
    });

    // Reset old rows synchronously so re-seeding during development
    // produces a deterministic fixture. mutations_sync=2 blocks until the
    // ALTER TABLE DELETE mutation has been applied on all replicas.
    const tolRunIds = tolRuns.map((r) => Number(r.id));
    if (tolRunIds.length > 0) {
      const runIdList = tolRunIds.join(",");
      await tolCh.command({
        query: `ALTER TABLE mlop_metrics DELETE WHERE tenantId = '${org.id}' AND projectName = '${project.name}' AND runId IN (${runIdList}) AND logName = 'train/loss' SETTINGS mutations_sync = 2`,
      });
      await tolCh.command({
        query: `ALTER TABLE mlop_files DELETE WHERE tenantId = '${org.id}' AND projectName = '${project.name}' AND runId IN (${runIdList}) AND logName = 'images/samples' SETTINGS mutations_sync = 2`,
      });
    }

    const tolMetricRows: Record<string, unknown>[] = [];
    const tolFileRows: Record<string, unknown>[] = [];
    const tolS3Uploads: Promise<unknown>[] = [];
    const baseTime = new Date('2025-01-01T00:00:00Z').getTime();
    const toIsoCh = (ms: number) =>
      new Date(ms).toISOString().replace('T', ' ').replace('Z', '');

    for (const run of tolRuns) {
      if (run.kind === 'offset') {
        // Metric at steps 0,10,20,...,100 — parabolic loss min at step 50.
        for (let s = 0; s <= 100; s += 10) {
          tolMetricRows.push({
            tenantId: org.id,
            projectName: project.name,
            runId: Number(run.id),
            logGroup: 'train',
            logName: 'train/loss',
            time: toIsoCh(baseTime + s * 1000),
            step: s,
            value: 0.1 + Math.pow(s - 50, 2) / 1000,
          });
        }
        // Image at steps 5,15,...,95 — offset by 5 from metric cadence.
        for (let s = 5; s < 100; s += 10) {
          const fileName = `offset_step_${String(s).padStart(4, '0')}.png`;
          const png = createSimplePNG(16, 16, (s * 2) % 256, 80, 120);
          const s3Key = `${org.id}/${project.name}/${run.id}/images/samples/${fileName}`;
          tolFileRows.push({
            tenantId: org.id,
            projectName: project.name,
            runId: Number(run.id),
            logGroup: 'images',
            logName: 'images/samples',
            time: toIsoCh(baseTime + s * 1000),
            step: s,
            fileName,
            fileType: 'image/png',
            fileSize: png.length,
          });
          tolS3Uploads.push(
            tolS3.send(new PutObjectCommand({
              Bucket: pinTestStorageBucket,
              Key: s3Key,
              Body: png,
              ContentType: 'image/png',
            })),
          );
        }
      } else {
        // hard case: metric argmin far from any image, 2nd-best near an image.
        const hardMetricSteps: [number, number][] = [
          // [step, value]
          [500, 0.01],   // true argmin — dist 500 from nearest image, filtered out
          [1002, 0.02],  // 2nd-smallest — dist 1 from image 1001/1003, qualifies
          [200, 0.5],    // filler so run has more than 2 rows
          [800, 0.4],    // filler
        ];
        for (const [s, v] of hardMetricSteps) {
          tolMetricRows.push({
            tenantId: org.id,
            projectName: project.name,
            runId: Number(run.id),
            logGroup: 'train',
            logName: 'train/loss',
            time: toIsoCh(baseTime + s * 1000),
            step: s,
            value: v,
          });
        }
        const hardImageSteps = [0, 1000, 1001, 1003];
        for (const s of hardImageSteps) {
          const fileName = `hard_step_${String(s).padStart(4, '0')}.png`;
          const png = createSimplePNG(16, 16, (s * 7) % 256, 120, 80);
          const s3Key = `${org.id}/${project.name}/${run.id}/images/samples/${fileName}`;
          tolFileRows.push({
            tenantId: org.id,
            projectName: project.name,
            runId: Number(run.id),
            logGroup: 'images',
            logName: 'images/samples',
            time: toIsoCh(baseTime + s * 1000),
            step: s,
            fileName,
            fileType: 'image/png',
            fileSize: png.length,
          });
          tolS3Uploads.push(
            tolS3.send(new PutObjectCommand({
              Bucket: pinTestStorageBucket,
              Key: s3Key,
              Body: png,
              ContentType: 'image/png',
            })),
          );
        }
      }
    }

    await tolCh.insert({
      table: 'mlop_metrics',
      values: tolMetricRows,
      format: 'JSONEachRow',
      clickhouse_settings: { async_insert: 0, wait_for_async_insert: 1 },
    });
    await tolCh.insert({
      table: 'mlop_files',
      values: tolFileRows,
      format: 'JSONEachRow',
      clickhouse_settings: { async_insert: 0, wait_for_async_insert: 1 },
    });
    await Promise.all(tolS3Uploads);
    // Summaries populated by the end-of-setup SYSTEM REFRESH.

    await tolCh.close();
    console.log(`   ✓ Seeded ${tolMetricRows.length} metrics + ${tolFileRows.length} images across ${tolRuns.length} tolerance-test runs`);
  }

  // 5g. Create multi-index-media runs with wandb-style list-of-media logging.
  // Each run logs multiple sample files at the same (logName, step) so the
  // multi-index nav UI can be exercised. Seeds 3 image widgets (one uniform,
  // two with sparse coverage matrices), 1 audio widget, 1 video widget. Used
  // by web/e2e/specs/media/multi-index-nav.spec.ts.
  console.log('\n5️⃣g Creating multi-index-media runs...');

  const multiIndexRunNames = [
    'multi-index-run-A',
    'multi-index-run-B',
    'multi-index-run-C',
  ];
  const multiIndexSteps = [0, 1, 2];

  // Sample-count matrices: counts[runIdx][stepIdx] = number of samples to
  // log for that (run, step). 0 = empty cell (filtered out of the section).
  // 1 = nav hidden (totalCount === 1). 2+ = nav shows "x / N".
  const imgGridUniform = [
    [3, 3, 3],
    [3, 3, 3],
    [3, 3, 3],
  ];
  const imgGrid2Sparse = [
    [1, 3, 2],
    [0, 2, 1],
    [3, 0, 3],
  ];
  const imgGrid3Sparser = [
    [0, 1, 2],
    [2, 1, 0],
    [1, 0, 1],
  ];
  const audioGridUniform = [
    [3, 3, 3],
    [3, 3, 3],
    [3, 3, 3],
  ];
  const videoGridUniform = [
    [2, 2, 2],
    [2, 2, 2],
    [2, 2, 2],
  ];

  interface MultiIndexMediaPlan {
    logName: string;
    logGroup: string;
    logType: 'IMAGE' | 'AUDIO' | 'VIDEO';
    mime: string;
    ext: string;
    counts: number[][];
  }

  const multiIndexMediaPlans: MultiIndexMediaPlan[] = [
    {
      logName: 'samples/img_grid',
      logGroup: 'samples',
      logType: 'IMAGE',
      mime: 'image/png',
      ext: 'png',
      counts: imgGridUniform,
    },
    {
      logName: 'samples/img_grid2',
      logGroup: 'samples',
      logType: 'IMAGE',
      mime: 'image/png',
      ext: 'png',
      counts: imgGrid2Sparse,
    },
    {
      logName: 'samples/img_grid3',
      logGroup: 'samples',
      logType: 'IMAGE',
      mime: 'image/png',
      ext: 'png',
      counts: imgGrid3Sparser,
    },
    {
      logName: 'samples/audio_grid',
      logGroup: 'samples',
      logType: 'AUDIO',
      mime: 'audio/wav',
      ext: 'wav',
      counts: audioGridUniform,
    },
    {
      logName: 'samples/video_grid',
      logGroup: 'samples',
      logType: 'VIDEO',
      mime: 'video/mp4',
      ext: 'mp4',
      counts: videoGridUniform,
    },
  ];

  const existingMultiIndexRuns = await prisma.runs.findMany({
    where: {
      projectId: project.id,
      organizationId: org.id,
      name: { in: multiIndexRunNames },
    },
    select: { id: true, name: true, createdAt: true },
  });
  const existingMultiIndexByName = new Map(
    existingMultiIndexRuns.map((r) => [r.name, r]),
  );

  const multiIndexCreatedAt = new Date(Date.now() - 361 * 24 * 60 * 60 * 1000);
  const createdMultiIndexRuns: { id: bigint; name: string; createdAt: Date; runIdx: number }[] = [];
  for (let i = 0; i < multiIndexRunNames.length; i++) {
    const name = multiIndexRunNames[i];
    let run = existingMultiIndexByName.get(name);
    if (!run) {
      run = await prisma.runs.create({
        data: {
          name,
          organizationId: org.id,
          projectId: project.id,
          createdById: user.id,
          creatorApiKeyId: apiKey.id,
          status: 'COMPLETED',
          tags: ['multi-index-test'],
          createdAt: new Date(multiIndexCreatedAt.getTime() + i * 1000),
          updatedAt: new Date(multiIndexCreatedAt.getTime() + i * 1000),
        },
      });
    }
    createdMultiIndexRuns.push({ ...run, runIdx: i });
  }

  // Register RunLogs for each (run, logName) pair where the run has at
  // least one sample across all steps. Skip empty (run, logName) pairs so
  // the logs browser doesn't show zero-data entries.
  const multiIndexLogRows: Array<{
    runId: bigint;
    logName: string;
    logGroup: string;
    logType: 'IMAGE' | 'AUDIO' | 'VIDEO';
  }> = [];
  for (const run of createdMultiIndexRuns) {
    for (const plan of multiIndexMediaPlans) {
      const total = plan.counts[run.runIdx].reduce((acc, n) => acc + n, 0);
      if (total === 0) continue;
      multiIndexLogRows.push({
        runId: run.id,
        logName: plan.logName,
        logGroup: plan.logGroup,
        logType: plan.logType,
      });
    }
  }
  await prisma.runLogs.createMany({
    data: multiIndexLogRows,
    skipDuplicates: true,
  });

  // Seed ClickHouse mlop_files + S3 objects for each (run, logName, step,
  // sampleIdx). Reuses the env vars from the pin-test block above.
  if (
    pinTestClickhouseUrl &&
    pinTestStorageEndpoint &&
    pinTestStorageAccessKey &&
    pinTestStorageSecretKey &&
    pinTestStorageBucket
  ) {
    const multiIndexS3 = new S3Client({
      endpoint: pinTestStorageEndpoint,
      region: process.env.STORAGE_REGION || 'us-east-1',
      credentials: {
        accessKeyId: pinTestStorageAccessKey,
        secretAccessKey: pinTestStorageSecretKey,
      },
      forcePathStyle: true,
    });

    const multiIndexCh = createClient({
      url: pinTestClickhouseUrl,
      username: process.env.CLICKHOUSE_USER || 'default',
      password: process.env.CLICKHOUSE_PASSWORD || '',
    });

    // Minimal silent WAV (44.1kHz mono, 16-bit, 0.05s)
    function makeMultiIndexWav(): Buffer {
      const sampleRate = 44100;
      const numSamples = Math.floor(sampleRate * 0.05);
      const dataSize = numSamples * 2;
      const buf = Buffer.alloc(44 + dataSize);
      buf.write('RIFF', 0);
      buf.writeUInt32LE(36 + dataSize, 4);
      buf.write('WAVE', 8);
      buf.write('fmt ', 12);
      buf.writeUInt32LE(16, 16);
      buf.writeUInt16LE(1, 20);
      buf.writeUInt16LE(1, 22);
      buf.writeUInt32LE(sampleRate, 24);
      buf.writeUInt32LE(sampleRate * 2, 28);
      buf.writeUInt16LE(2, 32);
      buf.writeUInt16LE(16, 34);
      buf.write('data', 36);
      buf.writeUInt32LE(dataSize, 40);
      return buf;
    }

    // Minimal MP4 stub (ftyp + mdat) — won't play but the file viewer + nav still render
    function makeMultiIndexMp4(): Buffer {
      const ftyp = Buffer.from([
        0x00, 0x00, 0x00, 0x14,
        0x66, 0x74, 0x79, 0x70,
        0x69, 0x73, 0x6f, 0x6d,
        0x00, 0x00, 0x02, 0x00,
        0x69, 0x73, 0x6f, 0x6d,
      ]);
      const mdat = Buffer.alloc(8);
      mdat.writeUInt32BE(8, 0);
      mdat.write('mdat', 4);
      return Buffer.concat([ftyp, mdat]);
    }

    const multiIndexFileRows: Record<string, unknown>[] = [];
    const multiIndexS3Uploads: Promise<unknown>[] = [];

    for (const run of createdMultiIndexRuns) {
      const baseTime = run.createdAt.getTime();
      for (const plan of multiIndexMediaPlans) {
        for (let stepIdx = 0; stepIdx < multiIndexSteps.length; stepIdx++) {
          const step = multiIndexSteps[stepIdx];
          const count = plan.counts[run.runIdx][stepIdx];
          for (let sampleIdx = 0; sampleIdx < count; sampleIdx++) {
            // Deterministic file name so we can compute it from the test side
            // if needed, and it lets us assert that next/prev actually changes
            // the displayed src.
            const shortLog = plan.logName.split('/').pop();
            const fileName = `${shortLog}-r${run.runIdx}-s${step}-i${sampleIdx}.${plan.ext}`;
            let bytes: Buffer;
            if (plan.logType === 'IMAGE') {
              // Distinct color per (run, step, sampleIdx) so visual changes are obvious
              const r = (run.runIdx * 80 + step * 30 + sampleIdx * 60) % 256;
              const g = (run.runIdx * 30 + step * 60 + sampleIdx * 90) % 256;
              const b = (run.runIdx * 60 + step * 90 + sampleIdx * 30) % 256;
              bytes = createSimplePNG(16, 16, r, g, b);
            } else if (plan.logType === 'AUDIO') {
              bytes = makeMultiIndexWav();
            } else {
              bytes = makeMultiIndexMp4();
            }
            const s3Key = `${org.id}/${project.name}/${run.id}/${plan.logName}/${fileName}`;
            multiIndexFileRows.push({
              tenantId: org.id,
              projectName: project.name,
              runId: Number(run.id),
              logGroup: plan.logGroup,
              logName: plan.logName,
              // Stagger time by sampleIdx so ORDER BY time gives a stable
              // sample order — matches the production query's behavior.
              time: new Date(baseTime + step * 1000 + sampleIdx * 10)
                .toISOString()
                .replace('T', ' ')
                .replace('Z', ''),
              step,
              fileName,
              fileType: plan.mime,
              fileSize: bytes.length,
            });
            multiIndexS3Uploads.push(
              multiIndexS3.send(
                new PutObjectCommand({
                  Bucket: pinTestStorageBucket,
                  Key: s3Key,
                  Body: bytes,
                  ContentType: plan.mime,
                }),
              ),
            );
          }
        }
      }
    }

    if (multiIndexFileRows.length > 0) {
      await multiIndexCh.insert({
        table: 'mlop_files',
        values: multiIndexFileRows,
        format: 'JSONEachRow',
        clickhouse_settings: {
          async_insert: 0,
          wait_for_async_insert: 1,
        },
      });
      console.log(`   ✓ Inserted ${multiIndexFileRows.length} multi-index mlop_files rows`);
    }
    if (multiIndexS3Uploads.length > 0) {
      await Promise.all(multiIndexS3Uploads);
      console.log(`   ✓ Uploaded ${multiIndexS3Uploads.length} multi-index media files to S3`);
    }

    await multiIndexCh.close();
  } else {
    console.log('   ⚠ Missing CLICKHOUSE_URL or STORAGE_* env vars, skipping multi-index seeding');
  }

  console.log(`   ✓ Ensured ${createdMultiIndexRuns.length} multi-index-media runs are seeded`);

  // 5h. Seed `run-groups-test` — the canonical project the Grouping v2
  //     smoke tests read from (Suite 17c). Five runs: one ungrouped,
  //     two under `group:alpha`, one each under `group:beta` and
  //     `group:gamma`. Encoded as `group:*` tag prefixes rather than a
  //     dedicated Runs.group column — matches how grouping-v2 emits
  //     bucket paths for `field: "tag-prefix:group"`. The mutation-
  //     isolated projects (mut-2a/2b/2c/mut-3/view-7) the retired
  //     run-groups.spec.ts owned were dropped when that spec went away.
  // ---------------------------------------------------------------------
  console.log('\n5️⃣g² Creating over-cap-test project (210 runs)...');

  // The batch data procs cap `runIds` at 200. No other seeded project comes
  // close — the bulk project is 160 — so without this fixture the over-cap
  // behaviour cannot be reached by any test that drives the UI honestly.
  //
  // Deliberately 1 metric per run: the cap counts RUNS, so breadth would only
  // cost seed time. Two media logs, and the split between them is the point:
  //
  //   over-cap/images  on all 210  → a media widget legitimately over the cap,
  //                                  so the "Too many runs" notice is CORRECT
  //   rare/images      on only 3   → 210 runs selected, narrowed to 3, RENDERS
  //
  // That second case is the one that fails on code which sends the whole
  // selection: it would report "Too many runs (210)" for a widget whose data
  // lives on three of them.
  const OVER_CAP_RUN_COUNT = 210;
  const OVER_CAP_RARE_RUNS = 3;
  const OVER_CAP_PROJECT = 'over-cap-test';
  const OVER_CAP_COMMON_LOG = 'over-cap/images';
  const OVER_CAP_RARE_LOG = 'rare/images';
  // Grouped so the metric lands in its own `train` group, which the E2E specs
  // filter the metric list down to. The same name is written into ClickHouse
  // below — the registry and the data must agree or the chart never draws.
  const OVER_CAP_METRIC = 'train/loss';

  const overCapProject = await prisma.projects.upsert({
    where: {
      organizationId_name: { organizationId: org.id, name: OVER_CAP_PROJECT },
    },
    create: { name: OVER_CAP_PROJECT, organizationId: org.id },
    update: {},
  });

  const overCapExisting = await prisma.runs.count({
    where: { projectId: overCapProject.id },
  });

  if (overCapExisting < OVER_CAP_RUN_COUNT) {
    await prisma.runs.createMany({
      data: Array.from({ length: OVER_CAP_RUN_COUNT }, (_, i) => ({
        // Zero-padded so lexical sort matches numeric order — tests select
        // "all" rather than by name, but a stable order keeps failures legible.
        name: `over-cap-run-${String(i).padStart(3, '0')}`,
        organizationId: org.id,
        projectId: overCapProject.id,
        createdById: user.id,
        creatorApiKeyId: apiKey.id,
        status: 'COMPLETED' as const,
        updatedAt: new Date(),
      })),
      skipDuplicates: true,
    });

    const overCapRuns = await prisma.runs.findMany({
      where: { projectId: overCapProject.id },
      select: { id: true, name: true, createdAt: true },
      orderBy: { name: 'asc' },
    });

    // Registry rows: one metric everywhere, the common image log everywhere,
    // the rare image log on the first three only.
    await prisma.runLogs.createMany({
      data: overCapRuns.flatMap((run, i) => [
        {
          runId: run.id,
          logGroup: 'train',
          logName: OVER_CAP_METRIC,
          logType: 'METRIC' as const,
        },
        {
          runId: run.id,
          logGroup: 'over-cap',
          logName: OVER_CAP_COMMON_LOG,
          logType: 'IMAGE' as const,
        },
        ...(i < OVER_CAP_RARE_RUNS
          ? [{
              runId: run.id,
              logGroup: 'rare',
              logName: OVER_CAP_RARE_LOG,
              logType: 'IMAGE' as const,
            }]
          : []),
      ]),
      skipDuplicates: true,
    });

    // 210 runs x 1 metric x 50 points — enough for a line to draw, small
    // enough that this fixture costs a fraction of a bulk run.
    await seedClickHouseMetrics(overCapRuns, org.id, OVER_CAP_PROJECT, 1, 50, [
      OVER_CAP_METRIC,
    ]);

    if (
      pinTestClickhouseUrl &&
      pinTestStorageEndpoint &&
      pinTestStorageAccessKey &&
      pinTestStorageSecretKey &&
      pinTestStorageBucket
    ) {
      const overCapS3 = new S3Client({
        endpoint: pinTestStorageEndpoint,
        region: process.env.STORAGE_REGION || 'us-east-1',
        credentials: {
          accessKeyId: pinTestStorageAccessKey,
          secretAccessKey: pinTestStorageSecretKey,
        },
        forcePathStyle: true,
      });
      const overCapCh = createClient({
        url: pinTestClickhouseUrl,
        username: process.env.CLICKHOUSE_USER || 'default',
        password: process.env.CLICKHOUSE_PASSWORD || '',
      });

      // One tiny PNG, uploaded once per (run, log). The assertions are about
      // which runs a widget asks for, never about pixels, so every row can
      // point at an identical image.
      const overCapPng = createSimplePNG(16, 16, 90, 160, 240);
      const overCapFileRows: Record<string, unknown>[] = [];
      const overCapUploads: Promise<unknown>[] = [];
      const overCapBase = Date.now() - 60_000;

      for (const [i, run] of overCapRuns.entries()) {
        const logs = [
          { logGroup: 'over-cap', logName: OVER_CAP_COMMON_LOG },
          ...(i < OVER_CAP_RARE_RUNS
            ? [{ logGroup: 'rare', logName: OVER_CAP_RARE_LOG }]
            : []),
        ];
        for (const log of logs) {
          const fileName = 'sample.png';
          const s3Key = `${org.id}/${OVER_CAP_PROJECT}/${run.id}/${log.logName}/${fileName}`;
          overCapFileRows.push({
            tenantId: org.id,
            projectName: OVER_CAP_PROJECT,
            runId: Number(run.id),
            logGroup: log.logGroup,
            logName: log.logName,
            time: new Date(overCapBase + i * 10)
              .toISOString()
              .replace('T', ' ')
              .replace('Z', ''),
            step: 0,
            fileName,
            fileType: 'image/png',
            fileSize: overCapPng.length,
          });
          overCapUploads.push(
            overCapS3.send(
              new PutObjectCommand({
                Bucket: pinTestStorageBucket,
                Key: s3Key,
                Body: overCapPng,
                ContentType: 'image/png',
              }),
            ),
          );
        }
      }

      await overCapCh.insert({
        table: 'mlop_files',
        values: overCapFileRows,
        format: 'JSONEachRow',
        clickhouse_settings: { async_insert: 0, wait_for_async_insert: 1 },
      });
      await Promise.all(overCapUploads);
      await overCapCh.close();
      console.log(
        `   ✓ Seeded ${overCapRuns.length} runs, ${overCapFileRows.length} images ` +
          `(${OVER_CAP_RARE_RUNS} with ${OVER_CAP_RARE_LOG})`,
      );
    }
  } else {
    console.log(`   ✓ over-cap-test already has ${overCapExisting} runs, skipping`);
  }

  console.log('\n5️⃣h Creating run-groups project...');

  // `optimizer` is a string config key (distinct values sgd/adam/adamw)
  // so the `config:optimizer` grouping smoke tests (Suite 17e) match on
  // textValue — avoids numeric `numericValue::text` formatting ambiguity
  // in an assertion we can't run locally. Buckets: sgd×2 (both alpha),
  // adam×2 (beta+gamma), adamw×1 (solo).
  const runGroupsSeed: Array<{ name: string; groupTag: string | null; optimizer: string }> = [
    { name: 'rg-solo', groupTag: null, optimizer: 'adamw' },
    { name: 'rg-alpha-1', groupTag: 'alpha', optimizer: 'sgd' },
    { name: 'rg-alpha-2', groupTag: 'alpha', optimizer: 'sgd' },
    { name: 'rg-beta', groupTag: 'beta', optimizer: 'adam' },
    { name: 'rg-gamma', groupTag: 'gamma', optimizer: 'adam' },
  ];

  const runGroupsProject = await prisma.projects.upsert({
    where: {
      organizationId_name: { organizationId: org.id, name: 'run-groups-test' },
    },
    create: { name: 'run-groups-test', organizationId: org.id },
    update: {},
  });

  await prisma.runs.createMany({
    data: runGroupsSeed.map((r) => ({
      name: r.name,
      tags: r.groupTag ? [`group:${r.groupTag}`] : [],
      // config.optimizer powers the `config:optimizer` grouping smoke
      // tests (Suite 17e).
      config: { optimizer: r.optimizer },
      organizationId: org.id,
      projectId: runGroupsProject.id,
      createdById: user.id,
      creatorApiKeyId: apiKey.id,
      status: 'COMPLETED' as const,
      updatedAt: new Date(),
    })),
    skipDuplicates: true,
  });

  // Backfill ProjectColumnKey + RunFieldValue so `config:optimizer` is
  // groupable/filterable server-side — grouping/group-filtering read
  // run_field_values, NOT the raw config JSON (see distinct-group-values.ts
  // and list-runs.ts). Same helper the bulk-run seed uses.
  const runGroupsRuns = await prisma.runs.findMany({
    where: { projectId: runGroupsProject.id, organizationId: org.id },
    select: { id: true, config: true, systemMetadata: true },
  });
  for (const rgRun of runGroupsRuns) {
    await extractAndUpsertColumnKeys(
      prisma,
      org.id,
      runGroupsProject.id,
      rgRun.config,
      rgRun.systemMetadata,
      rgRun.id,
    );
  }
  console.log(
    `   ✓ Ensured run-groups-test with ${runGroupsSeed.length} runs (+ config:optimizer backfill)`,
  );

  // 5i. Sweeps fixtures — the two projects e2e/specs/sweeps/sweeps.spec.ts
  //     reads. No SDK is involved and none is needed: there is no sweep entity,
  //     a sweep is exactly the set of runs carrying a `sweep:<id>` tag
  //     (list-sweeps.ts groups on `unnest(tags) ... LIKE 'sweep:%'`). So this
  //     seeds ordinary runs whose config carries the spec and whose objective
  //     lands in ClickHouse, which is all the feature ever sees.
  //
  //     Two projects, because the two kinds of sweep are two data paths rather
  //     than two rows of the same one (see sweep-config.ts):
  //
  //     - NATIVE `pluto.sweep()` — `sweep-e2e-test`, sweep 9u7xvjjs, 4 runs.
  //       The block is FLAT at `config.sweep` and carries the id and nothing
  //       else, because the SDK keeps the search space client-side in
  //       ~/.pluto/sweeps and injects only the sampled combination. The server
  //       therefore knows no method and no objective: the list renders a dash
  //       for both, the chart axes come from `inferSweptKeys` (lr and
  //       batch_size each take two values, so both are inferred as swept), and
  //       the objective is inferred as the first non-`sys/` metric — which is
  //       why `val_loss` is the only non-system metric these runs log.
  //     - MIGRATED from wandb — `sweep-migrate-check`, sweep cvxvtpim, 1 run.
  //       The block is NESTED at `config.wandb.sweep = {id, name, config:
  //       {method, metric, parameters}}` and the run carries `import:wandb`,
  //       which is what badges the row and what makes method/objective known
  //       server-side. Exactly one run on purpose: a single line is the
  //       degenerate case for the parallel-coordinates chart (every axis has
  //       zero span), and it must still draw rather than fall back to its
  //       "nothing to plot" state.
  //
  //     The native objective is `val_loss = lr * 10 + 1 / batch_size`, exact in
  //     binary for all four combinations, so the extremes are unambiguous and
  //     the best-run assertions are deterministic under either goal: minimum
  //     0.13125 (lr 0.01 / bs 32), maximum 1.0625 (lr 0.1 / bs 16).
  console.log('\n5️⃣i Creating sweeps fixtures...');

  /** Steps per metric — enough that `argMax(value, step)` is a real pick. */
  const SWEEP_STEPS = 12;
  /** Value at `step`, converging to `final` at the last step exactly. */
  const sweepCurve = (final: number, step: number) =>
    final + (SWEEP_STEPS - 1 - step) * 0.05;

  const sweepChUrl = process.env.CLICKHOUSE_URL;
  const sweepMetricRows: Record<string, unknown>[] = [];

  /** One metric series for a run, appended to the pending ClickHouse batch. */
  const pushSweepMetric = (
    projectName: string,
    runId: bigint,
    createdAt: Date,
    logName: string,
    logGroup: string,
    final: number,
  ) => {
    for (let step = 0; step < SWEEP_STEPS; step++) {
      sweepMetricRows.push({
        tenantId: org.id,
        projectName,
        runId: Number(runId),
        logGroup,
        logName,
        time: new Date(createdAt.getTime() + step * 1000)
          .toISOString()
          .replace('T', ' ')
          .replace('Z', ''),
        step,
        value: sweepCurve(final, step),
      });
    }
  };

  const NATIVE_SWEEP_ID = '9u7xvjjs';
  const MIGRATED_SWEEP_ID = 'cvxvtpim';

  const nativeSweepProject = await prisma.projects.upsert({
    where: {
      organizationId_name: { organizationId: org.id, name: 'sweep-e2e-test' },
    },
    create: { name: 'sweep-e2e-test', organizationId: org.id },
    update: {},
  });

  const nativeSweepExisting = await prisma.runs.findFirst({
    where: {
      projectId: nativeSweepProject.id,
      organizationId: org.id,
      tags: { has: `sweep:${NATIVE_SWEEP_ID}` },
    },
    select: { id: true },
  });

  if (!nativeSweepExisting) {
    // The full lr x batch_size grid, one run per combination.
    const nativeSweepSeed = [
      { lr: 0.1, batchSize: 16 },
      { lr: 0.1, batchSize: 32 },
      { lr: 0.01, batchSize: 16 },
      { lr: 0.01, batchSize: 32 },
    ];
    // ~359 days back, in line with the other fixture projects, so these runs
    // are never what the run table auto-selects.
    const nativeSweepBase = new Date(Date.now() - 359 * 24 * 60 * 60 * 1000);

    const nativeSweepRuns: { id: bigint; createdAt: Date; valLoss: number }[] = [];
    for (let i = 0; i < nativeSweepSeed.length; i++) {
      const s = nativeSweepSeed[i];
      const createdAt = new Date(nativeSweepBase.getTime() + i * 1000);
      const config = {
        lr: s.lr,
        batch_size: s.batchSize,
        // Flat block, id only — everything else stayed on the agent's disk.
        // Declaring a method or a metric here would make both known to the
        // server and silently retire the inference paths this fixture exists
        // to cover.
        sweep: { id: NATIVE_SWEEP_ID },
      };
      const run = await prisma.runs.create({
        data: {
          name: `sw-lr${s.lr}-bs${s.batchSize}`,
          organizationId: org.id,
          projectId: nativeSweepProject.id,
          createdById: user.id,
          creatorApiKeyId: apiKey.id,
          status: 'COMPLETED',
          tags: [`sweep:${NATIVE_SWEEP_ID}`],
          config,
          systemMetadata: { hostname: 'sweep-agent', python: '3.11' },
          createdAt,
          updatedAt: createdAt,
        },
      });
      nativeSweepRuns.push({
        id: run.id,
        createdAt,
        valLoss: s.lr * 10 + 1 / s.batchSize,
      });
      await extractAndUpsertColumnKeys(
        prisma,
        org.id,
        nativeSweepProject.id,
        config,
        { hostname: 'sweep-agent', python: '3.11' },
        run.id,
      );
    }

    // `sys/*` is registered as well as the objective: get-sweep drops those
    // from `availableMetrics`, and with them present the inferred objective is
    // a real choice rather than the only row in the table.
    await prisma.runLogs.createMany({
      data: nativeSweepRuns.flatMap((r) => [
        { runId: r.id, logName: 'val_loss', logGroup: '', logType: 'METRIC' as const },
        {
          runId: r.id,
          logName: 'sys/cpu.percentage.0',
          logGroup: 'sys',
          logType: 'METRIC' as const,
        },
      ]),
      skipDuplicates: true,
    });

    for (const r of nativeSweepRuns) {
      pushSweepMetric(nativeSweepProject.name, r.id, r.createdAt, 'val_loss', '', r.valLoss);
      pushSweepMetric(
        nativeSweepProject.name,
        r.id,
        r.createdAt,
        'sys/cpu.percentage.0',
        'sys',
        42,
      );
    }
    console.log(
      `   ✓ Created sweep-e2e-test with ${nativeSweepRuns.length} native runs (sweep:${NATIVE_SWEEP_ID})`,
    );
  } else {
    console.log('   ✓ sweep-e2e-test runs already exist');
  }

  const migratedSweepProject = await prisma.projects.upsert({
    where: {
      organizationId_name: {
        organizationId: org.id,
        name: 'sweep-migrate-check',
      },
    },
    create: { name: 'sweep-migrate-check', organizationId: org.id },
    update: {},
  });

  const migratedSweepExisting = await prisma.runs.findFirst({
    where: {
      projectId: migratedSweepProject.id,
      organizationId: org.id,
      tags: { has: `sweep:${MIGRATED_SWEEP_ID}` },
    },
    select: { id: true },
  });

  if (!migratedSweepExisting) {
    const migratedCreatedAt = new Date(Date.now() - 358 * 24 * 60 * 60 * 1000);
    /** Final `loss`, and the value the wandb summary block reports. */
    const migratedLoss = 0.1;
    // Shape produced by the wandb migration: the run's own sampled value at the
    // top level, everything the importer knows nested under `wandb`. The nested
    // block is dropped from the flattened config by get-sweep (a swept
    // hyperparameter is a scalar by construction), so only `lr` reaches the
    // chart — which is exactly the declared search space below.
    const migratedConfig = {
      lr: 0.1,
      wandb: {
        url: 'https://wandb.ai/acme/migrate-check/runs/u0d4j7me',
        state: 'finished',
        sweep: {
          id: MIGRATED_SWEEP_ID,
          name: MIGRATED_SWEEP_ID,
          config: {
            method: 'grid',
            metric: { goal: 'minimize', name: 'loss' },
            parameters: { lr: { values: [0.1, 0.01, 0.001] } },
          },
        },
        summary: { loss: migratedLoss },
      },
    };

    const migratedRun = await prisma.runs.create({
      data: {
        name: 'flowing-sweep-1',
        organizationId: org.id,
        projectId: migratedSweepProject.id,
        createdById: user.id,
        creatorApiKeyId: apiKey.id,
        status: 'COMPLETED',
        // `import:wandb` is what `fromWandb` is derived from — the wandb badge
        // marks imports only, since native is the default.
        tags: ['import:wandb', `sweep:${MIGRATED_SWEEP_ID}`],
        config: migratedConfig,
        systemMetadata: { hostname: 'wandb-import' },
        createdAt: migratedCreatedAt,
        updatedAt: migratedCreatedAt,
      },
    });

    await extractAndUpsertColumnKeys(
      prisma,
      org.id,
      migratedSweepProject.id,
      migratedConfig,
      { hostname: 'wandb-import' },
      migratedRun.id,
    );

    await prisma.runLogs.createMany({
      data: [
        { runId: migratedRun.id, logName: 'loss', logGroup: '', logType: 'METRIC' as const },
      ],
      skipDuplicates: true,
    });

    pushSweepMetric(
      migratedSweepProject.name,
      migratedRun.id,
      migratedCreatedAt,
      'loss',
      '',
      migratedLoss,
    );
    console.log(
      `   ✓ Created sweep-migrate-check with 1 migrated run (sweep:${MIGRATED_SWEEP_ID})`,
    );
  } else {
    console.log('   ✓ sweep-migrate-check runs already exist');
  }

  if (sweepChUrl && sweepMetricRows.length > 0) {
    const sweepCh = createClient({
      url: sweepChUrl,
      username: process.env.CLICKHOUSE_USER || 'default',
      password: process.env.CLICKHOUSE_PASSWORD || '',
    });
    await sweepCh.insert({
      table: 'mlop_metrics',
      values: sweepMetricRows,
      format: 'JSONEachRow',
    });
    await sweepCh.close();
    console.log(`   ✓ Seeded ${sweepMetricRows.length} sweep metric datapoints`);
  }

  // 5j. Native rich-media / rich-data fixtures — `native-media-test`.
  //
  //     Two runs, deliberately few, each carrying every feature the branch
  //     added on the render side: annotated images (boxes + real mask PNGs),
  //     JSON-backed figures and point clouds, an HTML artifact, string
  //     metrics, and tables with the cell types that used to fail the row
  //     schema. Everything here is what the pluto SDK itself writes — no
  //     `import:wandb` tag, no `config.wandb` block — because every one of
  //     these renderers dispatches on the shape of the row, not on where the
  //     run came from.
  //
  //     - `nm-annotated-1` (older) has all twelve logs.
  //     - `nm-annotated-2` (newer) has three, and exists for the things one
  //       run cannot show: multi-run overlays, and the mask lookup that must
  //       be scoped to its own run (both runs' masks share a file name and
  //       hold different class ids, so an unscoped lookup draws the wrong
  //       picture rather than no picture).
  //
  //     Dated ~357/~356 days back, in line with the other fixture projects,
  //     so these runs never win a "most recent" ordering somewhere else.
  console.log('\n5️⃣j Creating native-media fixtures...');

  const nmStorageEndpoint = process.env.STORAGE_ENDPOINT;
  const nmStorageAccessKey = process.env.STORAGE_ACCESS_KEY_ID;
  const nmStorageSecretKey = process.env.STORAGE_SECRET_ACCESS_KEY;
  const nmStorageBucket = process.env.STORAGE_BUCKET;
  const nmStorageRegion = process.env.STORAGE_REGION || 'us-east-1';
  const nmClickhouseUrl = process.env.CLICKHOUSE_URL;

  if (
    !nmClickhouseUrl ||
    !nmStorageEndpoint ||
    !nmStorageAccessKey ||
    !nmStorageSecretKey ||
    !nmStorageBucket
  ) {
    console.log(
      '   ⚠ Missing CLICKHOUSE_URL or STORAGE_* env vars, skipping native-media fixtures',
    );
  } else {
    const nmS3 = new S3Client({
      endpoint: nmStorageEndpoint,
      region: nmStorageRegion,
      credentials: {
        accessKeyId: nmStorageAccessKey,
        secretAccessKey: nmStorageSecretKey,
      },
      forcePathStyle: true,
    });
    const nmCh = createClient({
      url: nmClickhouseUrl,
      username: process.env.CLICKHOUSE_USER || 'default',
      password: process.env.CLICKHOUSE_PASSWORD || '',
    });

    const nmFileRows: Record<string, unknown>[] = [];
    const nmDataRows: Record<string, unknown>[] = [];
    const nmMetricRows: Record<string, unknown>[] = [];
    const nmUploads: Promise<unknown>[] = [];

    /** ClickHouse DateTime64(3) literal from an epoch millisecond value. */
    const chTime = (ms: number) =>
      new Date(ms).toISOString().replace('T', ' ').replace('Z', '');

    /** One file: an mlop_files row plus the object it points at in S3. */
    const pushFile = (opts: {
      projectName: string;
      runId: bigint;
      baseTime: number;
      logName: string;
      step: number;
      fileName: string;
      fileType: string;
      body: Buffer;
      contentType: string;
      caption?: string | null;
      sampleIndex?: number;
      annotations?: unknown;
    }) => {
      const logGroup = opts.logName.includes('/')
        ? opts.logName.slice(0, opts.logName.lastIndexOf('/'))
        : '';
      nmFileRows.push({
        tenantId: org.id,
        projectName: opts.projectName,
        runId: Number(opts.runId),
        logGroup,
        logName: opts.logName,
        time: chTime(opts.baseTime + opts.step * 1000),
        step: opts.step,
        fileName: opts.fileName,
        fileType: opts.fileType,
        fileSize: opts.body.length,
        caption: opts.caption ?? null,
        sampleIndex: opts.sampleIndex ?? 0,
        annotations:
          opts.annotations == null ? null : JSON.stringify(opts.annotations),
      });
      nmUploads.push(
        nmS3.send(
          new PutObjectCommand({
            // Exactly the layout getImageUrl signs against:
            // {tenantId}/{projectName}/{runId}/{logName}/{fileName}
            Bucket: nmStorageBucket,
            Key: `${org.id}/${opts.projectName}/${opts.runId}/${opts.logName}/${opts.fileName}`,
            Body: opts.body,
            ContentType: opts.contentType,
          }),
        ),
      );
    };

    /** One mlop_data row (a table step, or one step of a string series). */
    const pushData = (opts: {
      projectName: string;
      runId: bigint;
      baseTime: number;
      logName: string;
      dataType: string;
      step: number;
      data: string;
    }) => {
      const logGroup = opts.logName.includes('/')
        ? opts.logName.slice(0, opts.logName.lastIndexOf('/'))
        : '';
      nmDataRows.push({
        tenantId: org.id,
        projectName: opts.projectName,
        runId: Number(opts.runId),
        logGroup,
        logName: opts.logName,
        dataType: opts.dataType,
        time: chTime(opts.baseTime + opts.step * 1000),
        step: opts.step,
        data: opts.data,
      });
    };

    /** A short numeric curve, so these projects behave like any other. */
    const pushLossCurve = (
      projectName: string,
      runId: bigint,
      baseTime: number,
      start: number,
      slope: number,
    ) => {
      for (let step = 0; step < 10; step++) {
        nmMetricRows.push({
          tenantId: org.id,
          projectName,
          runId: Number(runId),
          logGroup: 'train',
          logName: 'train/loss',
          time: chTime(baseTime + step * 1000),
          step,
          value: start - slope * step,
        });
      }
    };

    const nmProject = await prisma.projects.upsert({
      where: {
        organizationId_name: { organizationId: org.id, name: NM_PROJECT },
      },
      create: { name: NM_PROJECT, organizationId: org.id },
      update: {},
    });

    const nmExisting = await prisma.runs.findFirst({
      where: {
        projectId: nmProject.id,
        organizationId: org.id,
        name: 'nm-annotated-1',
      },
      select: { id: true },
    });

    if (nmExisting) {
      console.log('   ✓ native-media-test runs already exist');
    } else {
      const nmConfig = { lr: 0.001, batch_size: 32, model: 'resnet50' };
      const nmSysMeta = { hostname: 'nm-fixture', python: '3.11' };

      const nmRun1CreatedAt = new Date(Date.now() - 357 * 24 * 60 * 60 * 1000);
      const nmRun2CreatedAt = new Date(Date.now() - 356 * 24 * 60 * 60 * 1000);

      const makeNmRun = async (name: string, createdAt: Date) => {
        const run = await prisma.runs.create({
          data: {
            name,
            organizationId: org.id,
            projectId: nmProject.id,
            createdById: user.id,
            creatorApiKeyId: apiKey.id,
            status: 'COMPLETED',
            tags: [],
            config: nmConfig,
            systemMetadata: nmSysMeta,
            createdAt,
            updatedAt: createdAt,
          },
        });
        await extractAndUpsertColumnKeys(
          prisma,
          org.id,
          nmProject.id,
          nmConfig,
          nmSysMeta,
          run.id,
        );
        return run;
      };

      const nmRun1 = await makeNmRun('nm-annotated-1', nmRun1CreatedAt);
      const nmRun2 = await makeNmRun('nm-annotated-2', nmRun2CreatedAt);

      const nmBase1 = nmRun1CreatedAt.getTime();
      const nmBase2 = nmRun2CreatedAt.getTime();

      // ── Annotated images + mask PNGs ────────────────────────────────────
      // Masks live in the SAME logName as the image that references them:
      // presigned URLs are signed per object key, so the mask resolver can
      // only find one that came back in the same file query. They carry
      // `fileType: "mask"`, which is what keeps them out of the image grid
      // (`excludeMaskFiles`) while leaving them in the query result.
      const segImage = (step: number) =>
        createSimplePNG(NM_IMAGE_SIZE, NM_IMAGE_SIZE, 40 + step * 10, 90, 160);

      pushFile({
        projectName: NM_PROJECT,
        runId: nmRun1.id,
        baseTime: nmBase1,
        logName: NM_SEG_LOG,
        step: 0,
        fileName: 'seg_step_0.png',
        fileType: 'png',
        body: segImage(0),
        contentType: 'image/png',
        caption: 'epoch 0 predictions vs truth',
        annotations: NM_SEG_ANNOTATIONS_STEP0,
      });
      pushFile({
        projectName: NM_PROJECT,
        runId: nmRun1.id,
        baseTime: nmBase1,
        logName: NM_SEG_LOG,
        step: 0,
        fileName: 'seg_step_0_mask.png',
        fileType: 'mask',
        body: createClassMaskPNG(NM_IMAGE_SIZE, NM_IMAGE_SIZE, NM_MASK_STEP0),
        contentType: 'image/png',
      });
      // Step 1 is bare: same log, no annotations at all. Gives every
      // annotation assertion a negative control in the same widget.
      pushFile({
        projectName: NM_PROJECT,
        runId: nmRun1.id,
        baseTime: nmBase1,
        logName: NM_SEG_LOG,
        step: 1,
        fileName: 'seg_step_1.png',
        fileType: 'png',
        body: segImage(1),
        contentType: 'image/png',
      });
      pushFile({
        projectName: NM_PROJECT,
        runId: nmRun1.id,
        baseTime: nmBase1,
        logName: NM_SEG_LOG,
        step: 2,
        fileName: 'seg_step_2.png',
        fileType: 'png',
        body: segImage(2),
        contentType: 'image/png',
        annotations: NM_SEG_ANNOTATIONS_STEP2,
      });
      pushFile({
        projectName: NM_PROJECT,
        runId: nmRun1.id,
        baseTime: nmBase1,
        logName: NM_SEG_LOG,
        step: 2,
        fileName: 'seg_step_2_mask.png',
        fileType: 'mask',
        body: createClassMaskPNG(NM_IMAGE_SIZE, NM_IMAGE_SIZE, (x) =>
          NM_MASK_STEP2(x),
        ),
        contentType: 'image/png',
      });
      pushFile({
        projectName: NM_PROJECT,
        runId: nmRun1.id,
        baseTime: nmBase1,
        logName: NM_SEG_LOG,
        step: 3,
        fileName: 'seg_step_3.png',
        fileType: 'png',
        body: segImage(3),
        contentType: 'image/png',
        annotations: NM_SEG_ANNOTATIONS_STEP3,
      });

      pushFile({
        projectName: NM_PROJECT,
        runId: nmRun2.id,
        baseTime: nmBase2,
        logName: NM_SEG_LOG,
        step: 0,
        fileName: 'seg_step_0.png',
        fileType: 'png',
        body: createSimplePNG(NM_IMAGE_SIZE, NM_IMAGE_SIZE, 160, 90, 40),
        contentType: 'image/png',
        caption: 'run 2 epoch 0',
        annotations: NM_SEG_ANNOTATIONS_RUN2,
      });
      pushFile({
        projectName: NM_PROJECT,
        runId: nmRun2.id,
        baseTime: nmBase2,
        logName: NM_SEG_LOG,
        step: 0,
        // Same name as run 1's mask, different contents — see NM_MASK_RUN2.
        fileName: 'seg_step_0_mask.png',
        fileType: 'mask',
        body: createClassMaskPNG(NM_IMAGE_SIZE, NM_IMAGE_SIZE, NM_MASK_RUN2),
        contentType: 'image/png',
      });

      // ── Captions + list-logged (multi-index) media ──────────────────────
      for (const sample of NM_CAPTION_SAMPLES) {
        pushFile({
          projectName: NM_PROJECT,
          runId: nmRun1.id,
          baseTime: nmBase1,
          logName: NM_CAPTION_LOG,
          step: 0,
          fileName: sample.fileName,
          fileType: 'png',
          body: createSimplePNG(16, 16, 20 + sample.sampleIndex * 60, 140, 200),
          contentType: 'image/png',
          caption: sample.caption,
          sampleIndex: sample.sampleIndex,
        });
      }
      // One uncaptioned image at a later step, so "no caption" is testable
      // without leaving the log.
      pushFile({
        projectName: NM_PROJECT,
        runId: nmRun1.id,
        baseTime: nmBase1,
        logName: NM_CAPTION_LOG,
        step: 1,
        fileName: 'cap_none.png',
        fileType: 'png',
        body: createSimplePNG(16, 16, 200, 140, 20),
        contentType: 'image/png',
      });

      // ── JSON-sniffed figures, point clouds, and a blob ──────────────────
      const jsonFile = (
        runId: bigint,
        baseTime: number,
        logName: string,
        fileName: string,
        payload: unknown,
      ) =>
        pushFile({
          projectName: NM_PROJECT,
          runId,
          baseTime,
          logName,
          step: 0,
          fileName,
          fileType: 'json',
          body: Buffer.from(JSON.stringify(payload), 'utf-8'),
          contentType: 'application/json',
        });

      jsonFile(nmRun1.id, nmBase1, 'figures/plotly_figure', NM_PLOTLY_FILE, NM_PLOTLY_FIGURE);
      jsonFile(nmRun1.id, nmBase1, 'figures/mpl_figure', NM_MPL_FILE, NM_MPL_FIGURE);
      jsonFile(nmRun1.id, nmBase1, 'figures/point_cloud', NM_CLOUD_FILE, NM_POINT_CLOUD);
      jsonFile(
        nmRun1.id,
        nmBase1,
        'figures/point_cloud_rgb',
        NM_CLOUD_RGB_FILE,
        NM_POINT_CLOUD_RGB,
      );
      jsonFile(nmRun1.id, nmBase1, 'figures/json_blob', NM_BLOB_FILE, NM_JSON_BLOB);
      // Run 2's figure is the same shape with different numbers, so a two-run
      // comparison can tell which card belongs to which run from the plot
      // alone (the y values differ, and so does the title).
      jsonFile(nmRun2.id, nmBase2, 'figures/plotly_figure', NM_PLOTLY_FILE, {
        ...NM_PLOTLY_FIGURE,
        data: [
          { ...NM_PLOTLY_FIGURE.data[0], y: [0.8, 0.5, 0.35, 0.28, 0.22] },
          { ...NM_PLOTLY_FIGURE.data[1], y: [0.95, 0.66, 0.5, 0.46, 0.44] },
        ],
        layout: { ...NM_PLOTLY_FIGURE.layout, title: 'Native Plotly Figure (run 2)' },
      });

      pushFile({
        projectName: NM_PROJECT,
        runId: nmRun1.id,
        baseTime: nmBase1,
        logName: 'figures/report',
        step: 0,
        fileName: 'report.html',
        fileType: 'html',
        body: Buffer.from(NM_HTML, 'utf-8'),
        contentType: 'text/html',
      });

      // ── String metrics (mlop_data, dataType `string-series`) ────────────
      // The `data` column holds the RAW value, not JSON: the read path returns
      // it verbatim as the category label.
      NM_PHASE_RUN1.forEach((value, step) =>
        pushData({
          projectName: NM_PROJECT,
          runId: nmRun1.id,
          baseTime: nmBase1,
          logName: 'status/phase',
          dataType: 'string-series',
          step,
          data: value,
        }),
      );
      NM_CHECKPOINT.forEach((value, step) =>
        pushData({
          projectName: NM_PROJECT,
          runId: nmRun1.id,
          baseTime: nmBase1,
          logName: 'status/checkpoint',
          dataType: 'string-series',
          step,
          data: value,
        }),
      );
      NM_PHASE_RUN2.forEach((value, step) =>
        pushData({
          projectName: NM_PROJECT,
          runId: nmRun2.id,
          baseTime: nmBase2,
          logName: 'status/phase',
          dataType: 'string-series',
          step,
          data: value,
        }),
      );

      // ── Tables ──────────────────────────────────────────────────────────
      for (const { step, rows } of NM_TABLE_EVAL_STEPS) {
        pushData({
          projectName: NM_PROJECT,
          runId: nmRun1.id,
          baseTime: nmBase1,
          logName: 'tables/eval_results',
          dataType: 'table',
          step,
          data: JSON.stringify({ col: NM_TABLE_EVAL_COLS, table: rows }),
        });
      }
      pushData({
        projectName: NM_PROJECT,
        runId: nmRun1.id,
        baseTime: nmBase1,
        logName: 'tables/predictions',
        dataType: 'table',
        step: 0,
        data: JSON.stringify(NM_TABLE_PREDICTIONS),
      });

      pushLossCurve(NM_PROJECT, nmRun1.id, nmBase1, 1, 0.05);
      pushLossCurve(NM_PROJECT, nmRun2.id, nmBase2, 0.9, 0.04);

      await prisma.runLogs.createMany({
        data: [
          // nm-annotated-1 — every log.
          { runId: nmRun1.id, logName: 'train/loss', logGroup: 'train', logType: 'METRIC' as const },
          { runId: nmRun1.id, logName: NM_SEG_LOG, logGroup: 'media', logType: 'IMAGE' as const },
          { runId: nmRun1.id, logName: NM_CAPTION_LOG, logGroup: 'media', logType: 'IMAGE' as const },
          { runId: nmRun1.id, logName: 'figures/plotly_figure', logGroup: 'figures', logType: 'FILE' as const },
          { runId: nmRun1.id, logName: 'figures/mpl_figure', logGroup: 'figures', logType: 'FILE' as const },
          { runId: nmRun1.id, logName: 'figures/point_cloud', logGroup: 'figures', logType: 'FILE' as const },
          { runId: nmRun1.id, logName: 'figures/point_cloud_rgb', logGroup: 'figures', logType: 'FILE' as const },
          { runId: nmRun1.id, logName: 'figures/json_blob', logGroup: 'figures', logType: 'FILE' as const },
          { runId: nmRun1.id, logName: 'figures/report', logGroup: 'figures', logType: 'FILE' as const },
          // DATA is the string-metric log type — it rides the file-discovery
          // proc but is routed to a categorical chart, not the Files tab.
          { runId: nmRun1.id, logName: 'status/phase', logGroup: 'status', logType: 'DATA' as const },
          { runId: nmRun1.id, logName: 'status/checkpoint', logGroup: 'status', logType: 'DATA' as const },
          { runId: nmRun1.id, logName: 'tables/eval_results', logGroup: 'tables', logType: 'TABLE' as const },
          { runId: nmRun1.id, logName: 'tables/predictions', logGroup: 'tables', logType: 'TABLE' as const },
          // nm-annotated-2 — the subset the multi-run cases need.
          { runId: nmRun2.id, logName: 'train/loss', logGroup: 'train', logType: 'METRIC' as const },
          { runId: nmRun2.id, logName: NM_SEG_LOG, logGroup: 'media', logType: 'IMAGE' as const },
          { runId: nmRun2.id, logName: 'status/phase', logGroup: 'status', logType: 'DATA' as const },
          { runId: nmRun2.id, logName: 'figures/plotly_figure', logGroup: 'figures', logType: 'FILE' as const },
        ],
        skipDuplicates: true,
      });

      console.log(
        `   ✓ Created ${NM_PROJECT} with 2 runs (${nmFileRows.length} files, ${nmDataRows.length} data rows)`,
      );
    }

    // 5k. RECORDED wandb-migration media / data — `wandb-migrate-media`.
    //
    //     Five runs replaying rows captured from real imports (see the WM_*
    //     provenance header). Every run carries `import:wandb`, which is what
    //     the wandb badge is derived from, and a `config.wandb` block, because
    //     that is what a migrated run actually looks like.
    //
    //     The image BODIES are generated rather than recorded: they are flat
    //     PNGs at the source images' exact dimensions (480x320 for the
    //     detection frames, 16x64 for the gallery). Only the size is
    //     load-bearing — the captured boxes are in pixel coordinates, so they
    //     only land in the right place on a correctly-sized frame — and a
    //     recorded 4KB photograph per step would bloat this file for nothing.
    //     The MASK is recorded byte for byte; that one's encoding matters.
    console.log('\n5️⃣k Creating recorded wandb-migration fixtures...');

    const wmProject = await prisma.projects.upsert({
      where: {
        organizationId_name: { organizationId: org.id, name: WM_MEDIA_PROJECT },
      },
      create: { name: WM_MEDIA_PROJECT, organizationId: org.id },
      update: {},
    });

    const wmExisting = await prisma.runs.findFirst({
      where: {
        projectId: wmProject.id,
        organizationId: org.id,
        name: 'wm-detections',
      },
      select: { id: true },
    });

    if (wmExisting) {
      console.log(`   ✓ ${WM_MEDIA_PROJECT} runs already exist`);
    } else {
      const wmSysMeta = { hostname: 'wandb-import', python: '3.11' };

      /** A migrated run: `import:wandb` plus a `config.wandb` block. */
      const makeWmRun = async (name: string, daysBack: number, projectId: bigint) => {
        const config = WM_CONFIG_BASE;
        const createdAt = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000);
        const run = await prisma.runs.create({
          data: {
            name,
            organizationId: org.id,
            projectId,
            createdById: user.id,
            creatorApiKeyId: apiKey.id,
            status: 'COMPLETED',
            tags: ['import:wandb'],
            config,
            systemMetadata: wmSysMeta,
            createdAt,
            updatedAt: createdAt,
          },
        });
        await extractAndUpsertColumnKeys(
          prisma,
          org.id,
          projectId,
          config,
          wmSysMeta,
          run.id,
        );
        return { run, base: createdAt.getTime() };
      };

      /**
       * The per-run history artifact the exporter always writes.
       *
       * Seeded because `metrics-display.tsx` hides log names matching
       * `run-<8 chars>-<name>:v<n>` outright, and a rule that hides something
       * needs something to hide or it is only ever tested by its absence.
       */
      const pushWandbArtifact = (
        projectName: string,
        runId: bigint,
        base: number,
        logName: string,
        fileName: string,
      ) =>
        pushFile({
          projectName,
          runId,
          baseTime: base,
          logName,
          step: 0,
          fileName,
          fileType: 'parquet',
          body: Buffer.from('PAR1recorded-fixture-stubPAR1', 'utf-8'),
          contentType: 'application/octet-stream',
          caption: '0000.parquet',
        });

      // ── wm-detections: boxes over one image log, a real mask over another ─
      const det = await makeWmRun('wm-detections', 354, wmProject.id);
      // 480x320 — the dimensions the captured pixel coordinates assume.
      const detFrame = (step: number) => createSimplePNG(480, 320, 60 + step * 20, 80, 110);

      const detSteps = [
        {
          step: 0,
          fileName: 'epoch-0---6-detections.9f403b73-6e42-4b0d-92e6-7a276e73072a.png',
          caption: 'epoch 0 — 6 detections',
          annotations: WM_DET_ANNOTATIONS_STEP0,
        },
        {
          step: 1,
          fileName: 'epoch-1---7-detections.45c9ba28-3aad-494e-ab27-f15e2ccbf404.png',
          caption: 'epoch 1 — 7 detections',
          annotations: WM_DET_ANNOTATIONS_STEP1,
        },
      ];
      for (const s of detSteps) {
        pushFile({
          projectName: WM_MEDIA_PROJECT,
          runId: det.run.id,
          baseTime: det.base,
          logName: 'val/detections',
          step: s.step,
          fileName: s.fileName,
          fileType: 'png',
          body: detFrame(s.step),
          contentType: 'image/png',
          caption: s.caption,
          annotations: s.annotations,
        });
      }

      const wmMaskPng = Buffer.from(WM_MASK_PNG_BASE64, 'base64');
      const segSteps = [
        {
          step: 0,
          fileName:
            'epoch-0---semantic-segmentation.79554e67-1177-48cd-bf86-364c5500da49.png',
          caption: 'epoch 0 — semantic segmentation',
          annotations: WM_SEG_ANNOTATIONS_STEP0,
          maskFileName: '91f6e810-1a4e-4c49-89a4-bb3becdebfa5.mask.png',
        },
        {
          step: 1,
          fileName:
            'epoch-1---semantic-segmentation.a8d1a9cd-f14c-43b9-9414-fe92bbfb5114.png',
          caption: 'epoch 1 — semantic segmentation',
          annotations: WM_SEG_ANNOTATIONS_STEP1,
          maskFileName: '81cc6e2e-1af4-4729-b71f-5e86461f05c4.mask.png',
        },
      ];
      for (const s of segSteps) {
        pushFile({
          projectName: WM_MEDIA_PROJECT,
          runId: det.run.id,
          baseTime: det.base,
          logName: 'val/segmentation',
          step: s.step,
          fileName: s.fileName,
          fileType: 'png',
          body: detFrame(s.step),
          contentType: 'image/png',
          caption: s.caption,
          annotations: s.annotations,
        });
        // Same recorded bytes under both names — the source run's two masks
        // are two renders of the same scene, and only the reference matters.
        pushFile({
          projectName: WM_MEDIA_PROJECT,
          runId: det.run.id,
          baseTime: det.base,
          logName: 'val/segmentation',
          step: s.step,
          fileName: s.maskFileName,
          fileType: 'mask',
          body: wmMaskPng,
          contentType: 'image/png',
        });
      }
      pushLossCurve(WM_MEDIA_PROJECT, det.run.id, det.base, 1.2, 0.08);

      // ── wm-exotic: the four artifacts that only content-sniffing can sort ─
      const exotic = await makeWmRun('wm-exotic', 353, wmProject.id);
      const exoticFiles = [
        {
          logName: 'plotly',
          step: 0,
          fileName: '0cfd84bf-eb1a-4b93-ba55-3bc15f7dd725.json',
          fileType: 'json',
          body: Buffer.from(JSON.stringify(WM_PLOTLY_FIGURE), 'utf-8'),
          contentType: 'application/json',
        },
        {
          logName: 'html',
          step: 1,
          fileName: 'ffa1824a-9afe-4623-a320-05d9d981cccf.html',
          fileType: 'html',
          body: Buffer.from(WM_HTML, 'utf-8'),
          contentType: 'text/html',
        },
        {
          logName: 'cloud',
          step: 2,
          fileName: '3d3a0da5-9055-414c-99f7-8dc965b099c8.json',
          fileType: 'json',
          body: Buffer.from(JSON.stringify(WM_POINT_CLOUD), 'utf-8'),
          contentType: 'application/json',
        },
        {
          logName: 'mpl',
          step: 3,
          fileName: '5966d8ca-2d83-4de3-9343-608058627145.json',
          fileType: 'json',
          body: Buffer.from(JSON.stringify(WM_MPL_FIGURE), 'utf-8'),
          contentType: 'application/json',
        },
      ];
      for (const f of exoticFiles) {
        pushFile({
          projectName: WM_MEDIA_PROJECT,
          runId: exotic.run.id,
          baseTime: exotic.base,
          ...f,
        });
      }
      // A wandb artifact dump whose file type IS renderable — the fixture that
      // separates the artifact-NAME rule from the renderable-TYPE one.
      //
      // The other two dumps are `.parquet`, which no widget can draw, so the
      // type rule hides them on its own and a view that dropped the name rule
      // still looked correct. This one is a raw `.json`, which is what the
      // exporter actually writes for a table artifact and what
      // `isRenderableInWidget` has to accept (only the body can tell a Plotly
      // figure from a blob) — so it renders as a widget on any view that stops
      // applying the name rule. The individual-run page did exactly that.
      //
      // Named `…-plotly_table:v0` on purpose: it shares the substring "plotly"
      // with `wm-exotic`'s real figure log, so a metric search for "plotly"
      // matches BOTH and the search can never be what hides it.
      pushFile({
        projectName: WM_MEDIA_PROJECT,
        runId: exotic.run.id,
        baseTime: exotic.base,
        logName: 'run-abcd1234-plotly_table:v0',
        step: 0,
        fileName: 'plotly_table.table.json',
        fileType: 'json',
        // Valid JSON that is neither a figure nor a point cloud, i.e. what a
        // wandb table artifact holds — if it ever does render, it renders as a
        // syntax-highlighted document, which is the bug.
        body: Buffer.from(
          JSON.stringify({
            columns: ['label', 'value'],
            data: [
              ['c0', 1],
              ['c1', 2],
            ],
          }),
          'utf-8',
        ),
        contentType: 'application/json',
      });
      pushLossCurve(WM_MEDIA_PROJECT, exotic.run.id, exotic.base, 0.5, 0);

      // ── wm-gallery: list-logged images, ordered only by sampleIndex ───────
      const gallery = await makeWmRun('wm-gallery', 352, wmProject.id);
      WM_GALLERY_UUIDS.forEach((uuid, sampleIndex) => {
        pushFile({
          projectName: WM_MEDIA_PROJECT,
          runId: gallery.run.id,
          baseTime: gallery.base,
          logName: 'gallery',
          step: 0,
          fileName: `idx${sampleIndex}.${uuid}.png`,
          fileType: 'png',
          // 16x64, the source gallery's dimensions.
          body: createSimplePNG(16, 64, (sampleIndex * 20) % 256, 120, 180),
          contentType: 'image/png',
          caption: `idx${sampleIndex}`,
          sampleIndex,
        });
      });
      WM_GALLERY_UUIDS_STEP1.forEach((uuid, sampleIndex) => {
        pushFile({
          projectName: WM_MEDIA_PROJECT,
          runId: gallery.run.id,
          baseTime: gallery.base,
          logName: 'gallery',
          step: 1,
          fileName: `idx${sampleIndex}.${uuid}.png`,
          fileType: 'png',
          body: createSimplePNG(16, 64, 200, (sampleIndex * 60) % 256, 40),
          contentType: 'image/png',
          caption: `idx${sampleIndex}`,
          sampleIndex,
        });
      });
      pushLossCurve(WM_MEDIA_PROJECT, gallery.run.id, gallery.base, 2, 0.1);

      // ── wm-strings: the string series wandb itself could not keep ────────
      const strings = await makeWmRun('wm-strings', 351, wmProject.id);
      WM_PHASE.forEach((value, step) =>
        pushData({
          projectName: WM_MEDIA_PROJECT,
          runId: strings.run.id,
          baseTime: strings.base,
          logName: 'phase',
          dataType: 'string-series',
          step,
          data: value,
        }),
      );
      pushLossCurve(WM_MEDIA_PROJECT, strings.run.id, strings.base, 0.9, 0.07);

      // ── wm-tables: bool + unicode cells, and a media column ──────────────
      const tables = await makeWmRun('wm-tables', 350, wmProject.id);
      // `dataType` is upper-case in every recorded row — the read path matches
      // it with `ILIKE 'table'`, and writing it lower-case here would retire
      // the only fixture that proves the case-insensitivity is needed.
      pushData({
        projectName: WM_MEDIA_PROJECT,
        runId: tables.run.id,
        baseTime: tables.base,
        logName: 'results',
        dataType: 'TABLE',
        step: 0,
        data: JSON.stringify(WM_RESULTS_TABLE),
      });
      pushData({
        projectName: WM_MEDIA_PROJECT,
        runId: tables.run.id,
        baseTime: tables.base,
        logName: 'media_table',
        dataType: 'TABLE',
        step: 0,
        data: JSON.stringify(WM_MEDIA_TABLE),
      });
      pushWandbArtifact(
        WM_MEDIA_PROJECT,
        tables.run.id,
        tables.base,
        'run-zvmxaggx-results:v0',
        '0000.parquet.c30c1f43-dd68-4eb3-9073-8b3912985cfd.parquet',
      );
      pushLossCurve(WM_MEDIA_PROJECT, tables.run.id, tables.base, 1.1, 0.06);

      await prisma.runLogs.createMany({
        data: [
          { runId: det.run.id, logName: 'val/detections', logGroup: 'val', logType: 'IMAGE' as const },
          { runId: det.run.id, logName: 'val/segmentation', logGroup: 'val', logType: 'IMAGE' as const },
          { runId: det.run.id, logName: 'train/loss', logGroup: 'train', logType: 'METRIC' as const },
          // ARTIFACT, not FILE: that is the type the exporter registers, and it
          // is what routes these to TextView / the file widget.
          { runId: exotic.run.id, logName: 'plotly', logGroup: '', logType: 'ARTIFACT' as const },
          { runId: exotic.run.id, logName: 'html', logGroup: '', logType: 'ARTIFACT' as const },
          { runId: exotic.run.id, logName: 'cloud', logGroup: '', logType: 'ARTIFACT' as const },
          { runId: exotic.run.id, logName: 'mpl', logGroup: '', logType: 'ARTIFACT' as const },
          // The renderable-`.json` dump. `logGroup: ''` is what the exporter
          // writes, so it lands in the SAME derived `files` group as the four
          // figures above — the arrangement that made the run page render it.
          {
            runId: exotic.run.id,
            logName: 'run-abcd1234-plotly_table:v0',
            logGroup: '',
            logType: 'ARTIFACT' as const,
          },
          { runId: exotic.run.id, logName: 'train/loss', logGroup: 'train', logType: 'METRIC' as const },
          { runId: gallery.run.id, logName: 'gallery', logGroup: '', logType: 'IMAGE' as const },
          { runId: gallery.run.id, logName: 'train/loss', logGroup: 'train', logType: 'METRIC' as const },
          { runId: strings.run.id, logName: 'phase', logGroup: '', logType: 'DATA' as const },
          { runId: strings.run.id, logName: 'train/loss', logGroup: 'train', logType: 'METRIC' as const },
          { runId: tables.run.id, logName: 'results', logGroup: '', logType: 'TABLE' as const },
          { runId: tables.run.id, logName: 'media_table', logGroup: '', logType: 'TABLE' as const },
          { runId: tables.run.id, logName: 'run-zvmxaggx-results:v0', logGroup: '', logType: 'ARTIFACT' as const },
          { runId: tables.run.id, logName: 'train/loss', logGroup: 'train', logType: 'METRIC' as const },
        ],
        skipDuplicates: true,
      });

      console.log(`   ✓ Created ${WM_MEDIA_PROJECT} with 5 recorded migrated runs`);
    }

    // 5l. RECORDED custom-chart panels — `wandb-migrate-charts`.
    //
    //     One run, six panels, six backing tables, all recorded. Its own
    //     project so the custom-charts section on the all-runs page is either
    //     entirely present (here) or entirely absent (everywhere else), with
    //     no run selection that half-populates it.
    console.log('\n5️⃣l Creating recorded custom-chart fixtures...');

    const wmChartsProject = await prisma.projects.upsert({
      where: {
        organizationId_name: { organizationId: org.id, name: WM_CHARTS_PROJECT },
      },
      create: { name: WM_CHARTS_PROJECT, organizationId: org.id },
      update: {},
    });

    const wmChartsExisting = await prisma.runs.findFirst({
      where: {
        projectId: wmChartsProject.id,
        organizationId: org.id,
        name: 'wm-custom-charts',
      },
      select: { id: true },
    });

    if (wmChartsExisting) {
      console.log(`   ✓ ${WM_CHARTS_PROJECT} runs already exist`);
    } else {
      const chartsCreatedAt = new Date(Date.now() - 349 * 24 * 60 * 60 * 1000);
      const chartsConfig = {
        ...WM_CONFIG_BASE,
        wandb: { ...WM_CONFIG_BASE.wandb, custom_charts: WM_PANELS },
      };
      const chartsSysMeta = { hostname: 'wandb-import', python: '3.11' };

      const chartsRun = await prisma.runs.create({
        data: {
          name: 'wm-custom-charts',
          organizationId: org.id,
          projectId: wmChartsProject.id,
          createdById: user.id,
          creatorApiKeyId: apiKey.id,
          status: 'COMPLETED',
          tags: ['import:wandb'],
          config: chartsConfig,
          systemMetadata: chartsSysMeta,
          createdAt: chartsCreatedAt,
          updatedAt: chartsCreatedAt,
        },
      });
      await extractAndUpsertColumnKeys(
        prisma,
        org.id,
        wmChartsProject.id,
        chartsConfig,
        chartsSysMeta,
        chartsRun.id,
      );

      const chartsBase = chartsCreatedAt.getTime();
      for (const [logName, entry] of Object.entries(WM_CHART_TABLES)) {
        pushData({
          projectName: WM_CHARTS_PROJECT,
          runId: chartsRun.id,
          baseTime: chartsBase,
          logName,
          dataType: 'TABLE',
          step: entry.step,
          data: JSON.stringify(entry.data),
        });
      }
      pushLossCurve(WM_CHARTS_PROJECT, chartsRun.id, chartsBase, 1, 0.05);

      await prisma.runLogs.createMany({
        data: [
          { runId: chartsRun.id, logName: 'train/loss', logGroup: 'train', logType: 'METRIC' as const },
          ...Object.keys(WM_CHART_TABLES).map((logName) => ({
            runId: chartsRun.id,
            logName,
            logGroup: '',
            logType: 'TABLE' as const,
          })),
          {
            runId: chartsRun.id,
            logName: 'run-fx2dl3j6-bar_table:v0',
            logGroup: '',
            logType: 'ARTIFACT' as const,
          },
        ],
        skipDuplicates: true,
      });

      console.log(
        `   ✓ Created ${WM_CHARTS_PROJECT} with 1 run and ${WM_PANELS.length} recorded panels`,
      );
    }

    if (nmFileRows.length > 0) {
      await nmCh.insert({
        table: 'mlop_files',
        values: nmFileRows,
        format: 'JSONEachRow',
      });
      console.log(`   ✓ Inserted ${nmFileRows.length} file rows into ClickHouse`);
    }
    if (nmDataRows.length > 0) {
      await nmCh.insert({
        table: 'mlop_data',
        values: nmDataRows,
        format: 'JSONEachRow',
      });
      console.log(`   ✓ Inserted ${nmDataRows.length} mlop_data rows into ClickHouse`);
    }
    if (nmMetricRows.length > 0) {
      await nmCh.insert({
        table: 'mlop_metrics',
        values: nmMetricRows,
        format: 'JSONEachRow',
      });
      console.log(`   ✓ Inserted ${nmMetricRows.length} metric datapoints into ClickHouse`);
    }
    if (nmUploads.length > 0) {
      await Promise.all(nmUploads);
      console.log(`   ✓ Uploaded ${nmUploads.length} fixture files to S3/MinIO`);
    }
    await nmCh.close();
  }

  // 6. Create a run in org 2 for org-switching tests
  console.log('\n6️⃣  Creating test run in org 2...');
  const existingOrg2Runs = await prisma.runs.findMany({
    where: {
      projectId: project2.id,
      organizationId: org2.id,
    },
  });

  if (existingOrg2Runs.length === 0) {
    await prisma.runs.create({
      data: {
        name: 'org2-unique-run',
        organizationId: org2.id,
        projectId: project2.id,
        createdById: user.id,
        creatorApiKeyId: apiKey2.id,
        status: 'COMPLETED',
        config: { framework: 'tensorflow' },
        systemMetadata: { hostname: 'test-host-2' },
      },
    });
    console.log(`   ✓ Created test run in org 2 (with org2's API key)`);
  } else {
    console.log(`   ✓ Org 2 runs already exist (${existingOrg2Runs.length} runs found)`);
  }

  // 7. Create "Auto-Hide Test" dashboard view for pattern-widget visibility E2E tests
  console.log('\n7️⃣  Creating Auto-Hide Test dashboard view...');

  const autoHideDashboardConfig = {
    version: 1,
    sections: [
      {
        id: 'section-matching-patterns',
        name: 'Matching Patterns',
        collapsed: false,
        widgets: [
          {
            id: 'widget-glob-train',
            type: 'chart',
            config: {
              metrics: ['glob:train/*'],
              xAxis: 'step',
              yAxisScale: 'linear',
              xAxisScale: 'linear',
              aggregation: 'LAST',
              showOriginal: false,
            },
            layout: { x: 0, y: 0, w: 4, h: 4 },
          },
          {
            id: 'widget-glob-train-metric0',
            type: 'chart',
            config: {
              metrics: ['glob:train/metric_0*'],
              xAxis: 'step',
              yAxisScale: 'linear',
              xAxisScale: 'linear',
              aggregation: 'LAST',
              showOriginal: false,
            },
            layout: { x: 4, y: 0, w: 4, h: 4 },
          },
          {
            id: 'widget-regex-train',
            type: 'chart',
            config: {
              metrics: ['regex:^train/metric_[0-2]\\d$'],
              xAxis: 'step',
              yAxisScale: 'linear',
              xAxisScale: 'linear',
              aggregation: 'LAST',
              showOriginal: false,
            },
            layout: { x: 8, y: 0, w: 4, h: 4 },
          },
        ],
      },
      {
        id: 'section-non-matching-patterns',
        name: 'Non-Matching Patterns',
        collapsed: false,
        widgets: [
          {
            id: 'widget-glob-validation',
            type: 'chart',
            config: {
              metrics: ['glob:validation/*'],
              xAxis: 'step',
              yAxisScale: 'linear',
              xAxisScale: 'linear',
              aggregation: 'LAST',
              showOriginal: false,
            },
            layout: { x: 0, y: 0, w: 3, h: 4 },
          },
          {
            id: 'widget-glob-nonexistent',
            type: 'chart',
            config: {
              metrics: ['glob:nonexistent/*'],
              xAxis: 'step',
              yAxisScale: 'linear',
              xAxisScale: 'linear',
              aggregation: 'LAST',
              showOriginal: false,
            },
            layout: { x: 3, y: 0, w: 3, h: 4 },
          },
          {
            id: 'widget-regex-nonexistent',
            type: 'chart',
            config: {
              metrics: ['regex:^doesnotexist/.*'],
              xAxis: 'step',
              yAxisScale: 'linear',
              xAxisScale: 'linear',
              aggregation: 'LAST',
              showOriginal: false,
            },
            layout: { x: 6, y: 0, w: 3, h: 4 },
          },
          {
            id: 'widget-glob-gpu',
            type: 'chart',
            config: {
              metrics: ['glob:gpu/*'],
              xAxis: 'step',
              yAxisScale: 'linear',
              xAxisScale: 'linear',
              aggregation: 'LAST',
              showOriginal: false,
            },
            layout: { x: 9, y: 0, w: 3, h: 4 },
          },
        ],
      },
      {
        id: 'section-literal-metrics',
        name: 'Literal Metrics',
        collapsed: false,
        widgets: [
          {
            id: 'widget-literal-existing',
            type: 'chart',
            config: {
              metrics: ['train/metric_00'],
              xAxis: 'step',
              yAxisScale: 'linear',
              xAxisScale: 'linear',
              aggregation: 'LAST',
              showOriginal: false,
            },
            layout: { x: 0, y: 0, w: 6, h: 4 },
          },
          {
            id: 'widget-literal-nonexistent',
            type: 'chart',
            config: {
              metrics: ['nonexistent/metric'],
              xAxis: 'step',
              yAxisScale: 'linear',
              xAxisScale: 'linear',
              aggregation: 'LAST',
              showOriginal: false,
            },
            layout: { x: 6, y: 0, w: 6, h: 4 },
          },
        ],
      },
      {
        id: 'section-mixed',
        name: 'Mixed',
        collapsed: false,
        widgets: [
          {
            id: 'widget-mixed-literal-and-pattern',
            type: 'chart',
            config: {
              metrics: ['train/metric_00', 'glob:nonexistent/*'],
              xAxis: 'step',
              yAxisScale: 'linear',
              xAxisScale: 'linear',
              aggregation: 'LAST',
              showOriginal: false,
            },
            layout: { x: 0, y: 0, w: 6, h: 4 },
          },
          {
            id: 'widget-mixed-patterns-only-matching',
            type: 'chart',
            config: {
              metrics: ['glob:train/*', 'glob:nonexistent/*'],
              xAxis: 'step',
              yAxisScale: 'linear',
              xAxisScale: 'linear',
              aggregation: 'LAST',
              showOriginal: false,
            },
            layout: { x: 6, y: 0, w: 6, h: 4 },
          },
        ],
      },
    ],
    settings: {
      gridCols: 12,
      rowHeight: 80,
      compactType: 'vertical',
    },
  };

  await prisma.dashboardView.upsert({
    where: {
      organizationId_projectId_name: {
        organizationId: org.id,
        projectId: project.id,
        name: 'Auto-Hide Test',
      },
    },
    update: { config: autoHideDashboardConfig },
    create: {
      name: 'Auto-Hide Test',
      organizationId: org.id,
      projectId: project.id,
      createdById: user.id,
      isDefault: false,
      config: autoHideDashboardConfig,
    },
  });
  console.log('   ✓ Created Auto-Hide Test dashboard view');

  // 8. Create "Staircase Zoom Test" dashboard view for zoom congruence E2E tests
  console.log('\n8️⃣  Creating Staircase Zoom Test dashboard view...');

  const staircaseZoomDashboardConfig = {
    version: 1,
    sections: [
      {
        id: 'section-staircase',
        name: 'Staircase',
        collapsed: false,
        widgets: [
          {
            id: 'step-staircase',
            type: 'chart',
            config: {
              metrics: ['test/staircase'],
              xAxis: 'step',
              yAxisScale: 'linear',
              xAxisScale: 'linear',
              aggregation: 'LAST',
              showOriginal: false,
            },
            layout: { x: 0, y: 0, w: 6, h: 6 },
          },
          {
            id: 'reltime-staircase',
            type: 'chart',
            config: {
              metrics: ['test/staircase'],
              xAxis: 'relative-time',
              yAxisScale: 'linear',
              xAxisScale: 'linear',
              aggregation: 'LAST',
              showOriginal: false,
            },
            layout: { x: 6, y: 0, w: 6, h: 6 },
          },
        ],
      },
      {
        id: 'section-irregular',
        name: 'Irregular Timing',
        collapsed: false,
        widgets: [
          {
            id: 'step-irregular',
            type: 'chart',
            config: {
              metrics: ['test/staircase_irregular'],
              xAxis: 'step',
              yAxisScale: 'linear',
              xAxisScale: 'linear',
              aggregation: 'LAST',
              showOriginal: false,
            },
            layout: { x: 0, y: 0, w: 6, h: 6 },
          },
          {
            id: 'reltime-irregular',
            type: 'chart',
            config: {
              metrics: ['test/staircase_irregular'],
              xAxis: 'relative-time',
              yAxisScale: 'linear',
              xAxisScale: 'linear',
              aggregation: 'LAST',
              showOriginal: false,
            },
            layout: { x: 6, y: 0, w: 6, h: 6 },
          },
        ],
      },
    ],
    settings: {
      gridCols: 12,
      rowHeight: 80,
      compactType: 'vertical',
    },
  };

  await prisma.dashboardView.upsert({
    where: {
      organizationId_projectId_name: {
        organizationId: org.id,
        projectId: project.id,
        name: 'Staircase Zoom Test',
      },
    },
    update: { config: staircaseZoomDashboardConfig },
    create: {
      name: 'Staircase Zoom Test',
      organizationId: org.id,
      projectId: project.id,
      createdById: user.id,
      isDefault: false,
      config: staircaseZoomDashboardConfig,
    },
  });
  console.log('   ✓ Created Staircase Zoom Test dashboard view');

  // 9. Create "NaN Inf Markers Test" dashboard view for non-finite markers E2E tests
  console.log('\n9️⃣  Creating NaN Inf Markers Test dashboard view...');

  const nanInfDashboardConfig = {
    version: 1,
    sections: [
      {
        id: 'section-mixed-nan',
        name: 'Mixed NaN (10% NaN + 90% finite)',
        collapsed: false,
        widgets: [
          {
            id: 'widget-mixed-auc',
            type: 'chart',
            config: {
              metrics: ['train/auc'],
              xAxis: 'step',
              yAxisScale: 'linear',
              xAxisScale: 'linear',
              aggregation: 'LAST',
              showOriginal: false,
            },
            layout: { x: 0, y: 0, w: 6, h: 4 },
          },
          {
            id: 'widget-mixed-perplexity',
            type: 'chart',
            config: {
              metrics: ['train/perplexity'],
              xAxis: 'step',
              yAxisScale: 'linear',
              xAxisScale: 'linear',
              aggregation: 'LAST',
              showOriginal: false,
            },
            layout: { x: 6, y: 0, w: 6, h: 4 },
          },
        ],
      },
      {
        id: 'section-inf',
        name: 'Infinity Values',
        collapsed: false,
        widgets: [
          {
            id: 'widget-pos-inf',
            type: 'chart',
            config: {
              metrics: ['train/epoch_time'],
              xAxis: 'step',
              yAxisScale: 'linear',
              xAxisScale: 'linear',
              aggregation: 'LAST',
              showOriginal: false,
            },
            layout: { x: 0, y: 0, w: 6, h: 4 },
          },
          {
            id: 'widget-neg-inf',
            type: 'chart',
            config: {
              metrics: ['train/precision'],
              xAxis: 'step',
              yAxisScale: 'linear',
              xAxisScale: 'linear',
              aggregation: 'LAST',
              showOriginal: false,
            },
            layout: { x: 6, y: 0, w: 6, h: 4 },
          },
        ],
      },
      {
        id: 'section-finite-control',
        name: 'Finite Control',
        collapsed: false,
        widgets: [
          {
            id: 'widget-finite-throughput',
            type: 'chart',
            config: {
              metrics: ['train/throughput'],
              xAxis: 'step',
              yAxisScale: 'linear',
              xAxisScale: 'linear',
              aggregation: 'LAST',
              showOriginal: false,
            },
            layout: { x: 0, y: 0, w: 6, h: 4 },
          },
          {
            id: 'widget-finite-latency',
            type: 'chart',
            config: {
              metrics: ['train/latency'],
              xAxis: 'step',
              yAxisScale: 'linear',
              xAxisScale: 'linear',
              aggregation: 'LAST',
              showOriginal: false,
            },
            layout: { x: 6, y: 0, w: 6, h: 4 },
          },
        ],
      },
    ],
    settings: {
      gridCols: 12,
      rowHeight: 80,
      compactType: 'vertical',
    },
  };

  await prisma.dashboardView.upsert({
    where: {
      organizationId_projectId_name: {
        organizationId: org.id,
        projectId: project.id,
        name: 'NaN Inf Markers Test',
      },
    },
    update: { config: nanInfDashboardConfig },
    create: {
      name: 'NaN Inf Markers Test',
      organizationId: org.id,
      projectId: project.id,
      createdById: user.id,
      isDefault: false,
      config: nanInfDashboardConfig,
    },
  });
  console.log('   ✓ Created NaN Inf Markers Test dashboard view');

  // 10. Create "Dynamic Section Test" dashboard view with a dynamic pattern section
  console.log('\n🔟  Creating Dynamic Section Test dashboard view...');

  const dynamicSectionDashboardConfig = {
    version: 1,
    sections: [
      {
        id: 'section-dynamic-train',
        name: 'Train Metrics (Dynamic)',
        collapsed: false,
        widgets: [],
        dynamicPattern: 'train/*',
        dynamicPatternMode: 'search',
      },
    ],
    settings: {
      gridCols: 12,
      rowHeight: 80,
      compactType: 'vertical',
    },
  };

  await prisma.dashboardView.upsert({
    where: {
      organizationId_projectId_name: {
        organizationId: org.id,
        projectId: project.id,
        name: 'Dynamic Section Test',
      },
    },
    update: { config: dynamicSectionDashboardConfig },
    create: {
      name: 'Dynamic Section Test',
      organizationId: org.id,
      projectId: project.id,
      createdById: user.id,
      isDefault: false,
      config: dynamicSectionDashboardConfig,
    },
  });
  console.log('   ✓ Created Dynamic Section Test dashboard view');

  // Two extra dashboard views for grouping E2E (PR #434):
  // - "Dynamic Section Grouping Test": suffix grouping only, all prefixes eligible
  // - "Dynamic Section Prefix Allowlist Test": suffix grouping + prefix allowlist
  const groupingDashboardConfig = {
    version: 1,
    sections: [
      {
        id: 'section-dynamic-grouping',
        name: 'Grad Norms (Grouped)',
        collapsed: false,
        widgets: [],
        dynamicPattern: 'gradients/norms/*',
        dynamicPatternMode: 'search',
        dynamicGroupBy: ['min', 'max', 'mean'],
      },
    ],
    settings: { gridCols: 12, rowHeight: 80, compactType: 'vertical' },
  };
  await prisma.dashboardView.upsert({
    where: {
      organizationId_projectId_name: {
        organizationId: org.id,
        projectId: project.id,
        name: 'Dynamic Section Grouping Test',
      },
    },
    update: { config: groupingDashboardConfig },
    create: {
      name: 'Dynamic Section Grouping Test',
      organizationId: org.id,
      projectId: project.id,
      createdById: user.id,
      isDefault: false,
      config: groupingDashboardConfig,
    },
  });
  console.log('   ✓ Created Dynamic Section Grouping Test dashboard view');

  const allowlistDashboardConfig = {
    version: 1,
    sections: [
      {
        id: 'section-dynamic-allowlist',
        name: 'Grad Norms (Allowlist)',
        collapsed: false,
        widgets: [],
        dynamicPattern: 'gradients/norms/*',
        dynamicPatternMode: 'search',
        dynamicGroupBy: ['min', 'max', 'mean'],
        dynamicGroupPrefixes: [
          'gradients/norms/model.encoder.layer_0',
          'gradients/norms/model.encoder.layer_1',
        ],
      },
    ],
    settings: { gridCols: 12, rowHeight: 80, compactType: 'vertical' },
  };
  await prisma.dashboardView.upsert({
    where: {
      organizationId_projectId_name: {
        organizationId: org.id,
        projectId: project.id,
        name: 'Dynamic Section Prefix Allowlist Test',
      },
    },
    update: { config: allowlistDashboardConfig },
    create: {
      name: 'Dynamic Section Prefix Allowlist Test',
      organizationId: org.id,
      projectId: project.id,
      createdById: user.id,
      isDefault: false,
      config: allowlistDashboardConfig,
    },
  });
  console.log('   ✓ Created Dynamic Section Prefix Allowlist Test dashboard view');

  // Regex-with-capture-groups grouping. Pattern matches the bitbrains-style
  // blah eval metrics seeded above; the regex captures (horizon, variant)
  // so each unique tuple becomes one combined widget bundling the 3 stat metrics.
  // Expected: 3 horizons × 2 variants = 6 combined widgets, no passthrough.
  const regexDashboardConfig = {
    version: 1,
    sections: [
      {
        id: 'section-dynamic-regex',
        name: 'Blah Eval (Regex)',
        collapsed: false,
        widgets: [],
        dynamicPattern: 'validation/blah/*',
        dynamicPatternMode: 'search',
        dynamicGroupBy: ['CRPS', 'MASE', 'MAPE'],
        dynamicGroupPrefixRegex: 'validation/blah/(.*?)/(original|smoothed)/',
      },
    ],
    settings: { gridCols: 12, rowHeight: 80, compactType: 'vertical' },
  };
  await prisma.dashboardView.upsert({
    where: {
      organizationId_projectId_name: {
        organizationId: org.id,
        projectId: project.id,
        name: 'Dynamic Section Regex Test',
      },
    },
    update: { config: regexDashboardConfig },
    create: {
      name: 'Dynamic Section Regex Test',
      organizationId: org.id,
      projectId: project.id,
      createdById: user.id,
      isDefault: false,
      config: regexDashboardConfig,
    },
  });
  console.log('   ✓ Created Dynamic Section Regex Test dashboard view');

  // 11. Create "Y-Zoom Widget Test" dashboard view for Y-axis zoom E2E tests
  console.log('\n1️⃣1️⃣  Creating Y-Zoom Widget Test dashboard view...');

  const yZoomWidgetDashboardConfig = {
    version: 1,
    sections: [
      {
        id: 'section-yzoom-test',
        name: 'Y-Zoom Test',
        collapsed: false,
        widgets: [
          {
            id: 'widget-yzoom-metric00',
            type: 'chart',
            config: {
              metrics: ['train/metric_00'],
              xAxis: 'step',
              yAxisScale: 'linear',
              xAxisScale: 'linear',
              aggregation: 'LAST',
              showOriginal: false,
            },
            layout: { x: 0, y: 0, w: 6, h: 4 },
          },
        ],
      },
    ],
    settings: {
      gridCols: 12,
      rowHeight: 80,
      compactType: 'vertical',
    },
  };

  await prisma.dashboardView.upsert({
    where: {
      organizationId_projectId_name: {
        organizationId: org.id,
        projectId: project.id,
        name: 'Y-Zoom Widget Test',
      },
    },
    update: { config: yZoomWidgetDashboardConfig },
    create: {
      name: 'Y-Zoom Widget Test',
      organizationId: org.id,
      projectId: project.id,
      createdById: user.id,
      isDefault: false,
      config: yZoomWidgetDashboardConfig,
    },
  });
  console.log('   ✓ Created Y-Zoom Widget Test dashboard view');

  // 12. Create "Folder Test" dashboard view for folder/subsection E2E tests
  console.log('\n1️⃣2️⃣  Creating Folder Test dashboard view...');

  const folderTestDashboardConfig = {
    version: 1,
    sections: [
      // Folder 1: Training — 1 static section + 1 dynamic section + 2 direct widgets
      {
        id: 'folder-training',
        name: 'Training',
        collapsed: false,
        widgets: [
          {
            id: 'folder-training-direct-w1',
            type: 'chart',
            config: {
              metrics: ['train/metric_04'],
              xAxis: 'step',
              yAxisScale: 'linear',
              xAxisScale: 'linear',
              aggregation: 'LAST',
              showOriginal: false,
              title: 'Training Folder Widget 1',
            },
            layout: { x: 0, y: 0, w: 6, h: 4 },
          },
          {
            id: 'folder-training-direct-w2',
            type: 'chart',
            config: {
              metrics: ['train/metric_05'],
              xAxis: 'step',
              yAxisScale: 'linear',
              xAxisScale: 'linear',
              aggregation: 'LAST',
              showOriginal: false,
              title: 'Training Folder Widget 2',
            },
            layout: { x: 6, y: 0, w: 6, h: 4 },
          },
        ],
        children: [
          {
            id: 'folder-training-static',
            name: 'Loss Curves',
            collapsed: false,
            widgets: [
              {
                id: 'folder-training-static-w1',
                type: 'chart',
                config: {
                  metrics: ['train/metric_00'],
                  xAxis: 'step',
                  yAxisScale: 'linear',
                  xAxisScale: 'linear',
                  aggregation: 'LAST',
                  showOriginal: false,
                  title: 'Training Loss',
                },
                layout: { x: 0, y: 0, w: 6, h: 4 },
              },
              {
                id: 'folder-training-static-w2',
                type: 'chart',
                config: {
                  metrics: ['train/metric_01'],
                  xAxis: 'step',
                  yAxisScale: 'linear',
                  xAxisScale: 'linear',
                  aggregation: 'LAST',
                  showOriginal: false,
                  title: 'Validation Loss',
                },
                layout: { x: 6, y: 0, w: 6, h: 4 },
              },
            ],
          },
          {
            id: 'folder-training-dynamic',
            name: 'All Train Metrics',
            collapsed: false,
            widgets: [],
            dynamicPattern: 'train/*',
            dynamicPatternMode: 'search',
          },
        ],
      },
      // Folder 2: Evaluation — 1 static section + 1 dynamic section + 2 direct widgets
      {
        id: 'folder-evaluation',
        name: 'Evaluation',
        collapsed: false,
        widgets: [
          {
            id: 'folder-eval-direct-w1',
            type: 'chart',
            config: {
              metrics: ['train/metric_06'],
              xAxis: 'step',
              yAxisScale: 'linear',
              xAxisScale: 'linear',
              aggregation: 'LAST',
              showOriginal: false,
              title: 'Eval Folder Widget 1',
            },
            layout: { x: 0, y: 0, w: 6, h: 4 },
          },
          {
            id: 'folder-eval-direct-w2',
            type: 'chart',
            config: {
              metrics: ['train/metric_07'],
              xAxis: 'step',
              yAxisScale: 'linear',
              xAxisScale: 'linear',
              aggregation: 'LAST',
              showOriginal: false,
              title: 'Eval Folder Widget 2',
            },
            layout: { x: 6, y: 0, w: 6, h: 4 },
          },
        ],
        children: [
          {
            id: 'folder-eval-static',
            name: 'Eval Charts',
            collapsed: false,
            widgets: [
              {
                id: 'folder-eval-static-w1',
                type: 'chart',
                config: {
                  metrics: ['train/metric_02'],
                  xAxis: 'step',
                  yAxisScale: 'linear',
                  xAxisScale: 'linear',
                  aggregation: 'LAST',
                  showOriginal: false,
                  title: 'Eval Accuracy',
                },
                layout: { x: 0, y: 0, w: 12, h: 4 },
              },
            ],
          },
          {
            id: 'folder-eval-dynamic',
            name: 'All Eval Metrics',
            collapsed: false,
            widgets: [],
            dynamicPattern: 'train/metric_0*',
            dynamicPatternMode: 'search',
          },
        ],
      },
      // Folder 3: Overview — 1 static section + 1 dynamic section + 2 direct widgets
      {
        id: 'folder-overview',
        name: 'Overview',
        collapsed: false,
        widgets: [
          {
            id: 'folder-overview-direct-w1',
            type: 'chart',
            config: {
              metrics: ['train/metric_08'],
              xAxis: 'step',
              yAxisScale: 'linear',
              xAxisScale: 'linear',
              aggregation: 'LAST',
              showOriginal: false,
              title: 'Overview Folder Widget 1',
            },
            layout: { x: 0, y: 0, w: 6, h: 4 },
          },
          {
            id: 'folder-overview-direct-w2',
            type: 'chart',
            config: {
              metrics: ['train/metric_09'],
              xAxis: 'step',
              yAxisScale: 'linear',
              xAxisScale: 'linear',
              aggregation: 'LAST',
              showOriginal: false,
              title: 'Overview Folder Widget 2',
            },
            layout: { x: 6, y: 0, w: 6, h: 4 },
          },
        ],
        children: [
          {
            id: 'folder-overview-static',
            name: 'Key Metrics',
            collapsed: false,
            widgets: [
              {
                id: 'folder-overview-static-w1',
                type: 'chart',
                config: {
                  metrics: ['train/metric_00', 'train/metric_01'],
                  xAxis: 'step',
                  yAxisScale: 'linear',
                  xAxisScale: 'linear',
                  aggregation: 'LAST',
                  showOriginal: false,
                  title: 'Key Metrics Combined',
                },
                layout: { x: 0, y: 0, w: 12, h: 4 },
              },
            ],
          },
          {
            id: 'folder-overview-dynamic',
            name: 'All Metrics',
            collapsed: false,
            widgets: [],
            dynamicPattern: '*',
            dynamicPatternMode: 'search',
          },
        ],
      },
      // Standalone section (not in a folder) for move tests
      {
        id: 'standalone-movable',
        name: 'Standalone Movable',
        collapsed: false,
        widgets: [
          {
            id: 'standalone-movable-w1',
            type: 'chart',
            config: {
              metrics: ['train/metric_03'],
              xAxis: 'step',
              yAxisScale: 'linear',
              xAxisScale: 'linear',
              aggregation: 'LAST',
              showOriginal: false,
              title: 'Movable Chart',
            },
            layout: { x: 0, y: 0, w: 12, h: 4 },
          },
        ],
      },
    ],
    settings: {
      gridCols: 12,
      rowHeight: 80,
      compactType: 'vertical',
    },
  };

  await prisma.dashboardView.upsert({
    where: {
      organizationId_projectId_name: {
        organizationId: org.id,
        projectId: project.id,
        name: 'Folder Test',
      },
    },
    update: { config: folderTestDashboardConfig },
    create: {
      name: 'Folder Test',
      organizationId: org.id,
      projectId: project.id,
      createdById: user.id,
      isDefault: false,
      config: folderTestDashboardConfig,
    },
  });
  console.log('   ✓ Created Folder Test dashboard view');

  // 11b. Create "Media Widgets Test" dashboard view with all non-line-chart file types
  console.log('\n1️⃣1️⃣b Creating Media Widgets Test dashboard view...');

  const mediaWidgetsDashboardConfig = {
    version: 1,
    sections: [
      {
        id: 'media-dynamic-section',
        name: 'All Media (Dynamic)',
        collapsed: false,
        widgets: [],
        dynamicPattern: '^(images\\/training_viz|distributions\\/weights|video\\/animation|audio\\/tone_sample)$',
        dynamicPatternMode: 'regex',
      },
      {
        id: 'media-static-section',
        name: 'All Media (Static)',
        collapsed: false,
        widgets: [
          {
            id: 'media-static-multiselect',
            type: 'file-group',
            config: {
              title: 'All media types (explicit)',
              files: ['audio/tone_sample', 'distributions/weights', 'images/training_viz', 'video/animation'],
            },
            layout: { x: 0, y: 0, w: 6, h: 5 },
          },
          {
            id: 'media-static-regex-multiselect',
            type: 'file-group',
            config: {
              title: 'All media types (regex)',
              files: ['regex:^(audio\\/tone_sample|distributions\\/weights|images\\/training_viz|video\\/animation)$'],
            },
            layout: { x: 6, y: 0, w: 6, h: 5 },
          },
          {
            id: 'media-static-images-1',
            type: 'file-group',
            config: { files: ['images/training_viz'] },
            layout: { x: 0, y: 5, w: 6, h: 5 },
          },
          {
            id: 'media-static-images-2',
            type: 'file-group',
            config: { files: ['images/training_viz'] },
            layout: { x: 6, y: 5, w: 6, h: 5 },
          },
          {
            id: 'media-static-histograms-1',
            type: 'file-group',
            config: { files: ['distributions/gradients'] },
            layout: { x: 0, y: 10, w: 6, h: 5 },
          },
          {
            id: 'media-static-histograms-2',
            type: 'file-group',
            config: { files: ['distributions/gradients'] },
            layout: { x: 6, y: 10, w: 6, h: 5 },
          },
          {
            id: 'media-static-audio-1',
            type: 'file-group',
            config: { files: ['audio/tone_sample'] },
            layout: { x: 0, y: 15, w: 6, h: 5 },
          },
          {
            id: 'media-static-audio-2',
            type: 'file-group',
            config: { files: ['audio/tone_sample'] },
            layout: { x: 6, y: 15, w: 6, h: 5 },
          },
          {
            id: 'media-static-video-1',
            type: 'file-group',
            config: { files: ['video/animation'] },
            layout: { x: 0, y: 20, w: 6, h: 5 },
          },
          {
            id: 'media-static-video-2',
            type: 'file-group',
            config: { files: ['video/animation'] },
            layout: { x: 6, y: 20, w: 6, h: 5 },
          },
          {
            id: 'media-static-console-1',
            type: 'file-group',
            config: { files: ['sys.stderr'] },
            layout: { x: 0, y: 25, w: 6, h: 5 },
          },
          {
            id: 'media-static-console-2',
            type: 'file-group',
            config: { files: ['sys.stderr'] },
            layout: { x: 6, y: 25, w: 6, h: 5 },
          },
        ],
      },
    ],
    settings: { gridCols: 12, rowHeight: 80, compactType: 'vertical' },
  };

  await prisma.dashboardView.upsert({
    where: {
      organizationId_projectId_name: {
        organizationId: org.id,
        projectId: project.id,
        name: 'Media Widgets Test',
      },
    },
    update: { config: mediaWidgetsDashboardConfig },
    create: {
      name: 'Media Widgets Test',
      organizationId: org.id,
      projectId: project.id,
      createdById: user.id,
      isDefault: false,
      config: mediaWidgetsDashboardConfig,
    },
  });
  console.log('   ✓ Created Media Widgets Test dashboard view');

  // 11b-bis. Create "Image Pinning Test" dashboard view for image-pinning E2E tests
  // Has a static section with 2 image widgets (training_viz + attention_maps)
  // and a dynamic section matching both via regex. Used together with
  // pin-test-run-A/B/C and a-bulk-run-011/012/013 to test per-widget pinning
  // across all 6 locations.
  console.log('\n1️⃣1️⃣b-bis Creating Image Pinning Test dashboard view...');

  const imagePinningDashboardConfig = {
    version: 1,
    sections: [
      {
        id: 'image-pinning-dynamic-section',
        name: 'Image Pinning Dynamic',
        collapsed: false,
        widgets: [],
        dynamicPattern: '^images/(training_viz|attention_maps)$',
        dynamicPatternMode: 'regex',
      },
      {
        id: 'image-pinning-static-section',
        name: 'Image Pinning Static',
        collapsed: false,
        widgets: [
          {
            id: 'image-pinning-static-training',
            type: 'file-group',
            config: { files: ['images/training_viz'] },
            layout: { x: 0, y: 0, w: 6, h: 5 },
          },
          {
            id: 'image-pinning-static-attention',
            type: 'file-group',
            config: { files: ['images/attention_maps'] },
            layout: { x: 6, y: 0, w: 6, h: 5 },
          },
        ],
      },
    ],
    settings: { gridCols: 12, rowHeight: 80, compactType: 'vertical' },
  };

  await prisma.dashboardView.upsert({
    where: {
      organizationId_projectId_name: {
        organizationId: org.id,
        projectId: project.id,
        name: 'Image Pinning Test',
      },
    },
    update: { config: imagePinningDashboardConfig },
    create: {
      name: 'Image Pinning Test',
      organizationId: org.id,
      projectId: project.id,
      createdById: user.id,
      isDefault: false,
      config: imagePinningDashboardConfig,
    },
  });
  console.log('   ✓ Created Image Pinning Test dashboard view');

  // 11b-bis-1b. "Media Best-Step Test" dashboard — the video/audio analogue of
  // "Image Pinning Test", used by media-best-step-pinning.spec.ts to verify the
  // per-widget "with media" argmin pin snaps video AND audio widgets (not just
  // images) now that the best-step file filter matches all media. Two widgets
  // per media type at DISTINCT logNames (training_viz vs attention_maps) so the
  // per-widget-differs assertion has two steps to compare.
  const mediaBestStepDashboardConfig = {
    version: 1,
    sections: [
      {
        id: 'media-best-step-dynamic-section',
        name: 'Media Best-Step Dynamic',
        collapsed: false,
        widgets: [],
        dynamicPattern: '^(video|audio)/(training_viz|attention_maps)$',
        dynamicPatternMode: 'regex',
      },
      {
        id: 'media-best-step-static-section',
        name: 'Media Best-Step Static',
        collapsed: false,
        widgets: [
          {
            id: 'media-best-step-static-video-training',
            type: 'file-group',
            config: { files: ['video/training_viz'] },
            layout: { x: 0, y: 0, w: 6, h: 5 },
          },
          {
            id: 'media-best-step-static-video-attention',
            type: 'file-group',
            config: { files: ['video/attention_maps'] },
            layout: { x: 6, y: 0, w: 6, h: 5 },
          },
          {
            id: 'media-best-step-static-audio-training',
            type: 'file-group',
            config: { files: ['audio/training_viz'] },
            layout: { x: 0, y: 5, w: 6, h: 5 },
          },
          {
            id: 'media-best-step-static-audio-attention',
            type: 'file-group',
            config: { files: ['audio/attention_maps'] },
            layout: { x: 6, y: 5, w: 6, h: 5 },
          },
        ],
      },
    ],
    settings: { gridCols: 12, rowHeight: 80, compactType: 'vertical' },
  };

  await prisma.dashboardView.upsert({
    where: {
      organizationId_projectId_name: {
        organizationId: org.id,
        projectId: project.id,
        name: 'Media Best-Step Test',
      },
    },
    update: { config: mediaBestStepDashboardConfig },
    create: {
      name: 'Media Best-Step Test',
      organizationId: org.id,
      projectId: project.id,
      createdById: user.id,
      isDefault: false,
      config: mediaBestStepDashboardConfig,
    },
  });
  console.log('   ✓ Created Media Best-Step Test dashboard view');

  // 11b-bis-2. Create "Media Pinning Test" dashboard view for the
  // video-audio-pinning E2E tests. Mirrors "Image Pinning Test": a static
  // section with TWO widgets per media type, each a DISTINCT logName
  // (audio/tone_sample + audio/speech_sample, video/animation +
  // video/reconstruction), plus a dynamic section whose regex matches both
  // logNames of each type. Distinct logNames are REQUIRED: per-widget pin
  // scoping (excludedWidgets / pinnedRunsByWidget) is keyed by logName, so
  // "unpin this widget only" can only keep the pin on a sibling widget when
  // that sibling renders a different logName. (The general "Media Widgets
  // Test" dashboard intentionally reuses the same logName across its two
  // audio/video widgets, which makes per-widget unpin ambiguous there.)
  console.log('\n1️⃣1️⃣b-bis-2 Creating Media Pinning Test dashboard view...');

  const mediaPinningDashboardConfig = {
    version: 1,
    sections: [
      {
        id: 'media-pinning-dynamic-section',
        name: 'Media Pinning Dynamic',
        collapsed: false,
        widgets: [],
        dynamicPattern: '^(audio/(tone_sample|speech_sample)|video/(animation|reconstruction))$',
        dynamicPatternMode: 'regex',
      },
      {
        id: 'media-pinning-static-section',
        name: 'Media Pinning Static',
        collapsed: false,
        widgets: [
          {
            id: 'media-pinning-static-audio-1',
            type: 'file-group',
            config: { files: ['audio/tone_sample'] },
            layout: { x: 0, y: 0, w: 6, h: 5 },
          },
          {
            id: 'media-pinning-static-audio-2',
            type: 'file-group',
            config: { files: ['audio/speech_sample'] },
            layout: { x: 6, y: 0, w: 6, h: 5 },
          },
          {
            id: 'media-pinning-static-video-1',
            type: 'file-group',
            config: { files: ['video/animation'] },
            layout: { x: 0, y: 5, w: 6, h: 5 },
          },
          {
            id: 'media-pinning-static-video-2',
            type: 'file-group',
            config: { files: ['video/reconstruction'] },
            layout: { x: 6, y: 5, w: 6, h: 5 },
          },
        ],
      },
    ],
    settings: { gridCols: 12, rowHeight: 80, compactType: 'vertical' },
  };

  await prisma.dashboardView.upsert({
    where: {
      organizationId_projectId_name: {
        organizationId: org.id,
        projectId: project.id,
        name: 'Media Pinning Test',
      },
    },
    update: { config: mediaPinningDashboardConfig },
    create: {
      name: 'Media Pinning Test',
      organizationId: org.id,
      projectId: project.id,
      createdById: user.id,
      isDefault: false,
      config: mediaPinningDashboardConfig,
    },
  });
  console.log('   ✓ Created Media Pinning Test dashboard view');

  // 11b-ter. Create "Multi-Index Media Test" dashboard view for the
  // multi-index-nav E2E tests. Used together with multi-index-run-A/B/C.
  // Static section: one widget per logName so each test can target a
  // specific widget. T5 (multi-type independence) needs image + audio +
  // video widgets co-located in the same section, which is satisfied here.
  // Dynamic section: regex matching all five samples/* logNames so the
  // same tests work in AR-DD / IR-DD locations.
  console.log('\n1️⃣1️⃣b-ter Creating Multi-Index Media Test dashboard views...');

  // IMPORTANT: the static and dynamic sections live in SEPARATE dashboards, not
  // one combined dashboard. A single dashboard with both sections renders every
  // samples/* widget TWICE (once per section), which (a) makes a logName lookup
  // ambiguous — a lazy `.first()` flips between the two copies as the page
  // scrolls, so a test sets a widget's sync mode on one copy but navigates the
  // other — and (b) doubles the page height past the VirtualizedChart unload
  // margin so widgets unmount/reset mid-test. One section per dashboard keeps
  // each logName unique and the page short enough that nothing unmounts.
  // DS locations use the static dashboard; DD locations use the dynamic one.
  const multiIndexStaticSection = {
    id: 'multi-index-static-section',
    name: 'Multi-Index Media (Static)',
    collapsed: false,
    widgets: [
      {
        id: 'multi-index-static-img-grid',
        type: 'file-group',
        config: { files: ['samples/img_grid'] },
        layout: { x: 0, y: 0, w: 6, h: 5 },
      },
      {
        id: 'multi-index-static-audio-grid',
        type: 'file-group',
        config: { files: ['samples/audio_grid'] },
        layout: { x: 6, y: 0, w: 6, h: 5 },
      },
      {
        id: 'multi-index-static-video-grid',
        type: 'file-group',
        config: { files: ['samples/video_grid'] },
        layout: { x: 0, y: 5, w: 6, h: 5 },
      },
      {
        id: 'multi-index-static-img-grid2',
        type: 'file-group',
        config: { files: ['samples/img_grid2'] },
        layout: { x: 6, y: 5, w: 6, h: 5 },
      },
      {
        id: 'multi-index-static-img-grid3',
        type: 'file-group',
        config: { files: ['samples/img_grid3'] },
        layout: { x: 0, y: 10, w: 6, h: 5 },
      },
    ],
  };

  const multiIndexDynamicSection = {
    id: 'multi-index-dynamic-section',
    name: 'Multi-Index Media (Dynamic)',
    collapsed: false,
    widgets: [],
    dynamicPattern: '^samples/(img_grid|img_grid2|img_grid3|audio_grid|video_grid)$',
    dynamicPatternMode: 'regex',
  };

  const gridSettings = { gridCols: 12, rowHeight: 80, compactType: 'vertical' };

  const multiIndexDashboards = [
    { name: 'Multi-Index Media Test', sections: [multiIndexStaticSection] },
    { name: 'Multi-Index Media Test (Dynamic)', sections: [multiIndexDynamicSection] },
  ];

  for (const { name, sections } of multiIndexDashboards) {
    const config = { version: 1, sections, settings: gridSettings };
    await prisma.dashboardView.upsert({
      where: {
        organizationId_projectId_name: {
          organizationId: org.id,
          projectId: project.id,
          name,
        },
      },
      update: { config },
      create: {
        name,
        organizationId: org.id,
        projectId: project.id,
        createdById: user.id,
        isDefault: false,
        config,
      },
    });
    console.log(`   ✓ Created ${name} dashboard view`);
  }

  // 11d. Seed bars-test-project for {bars} categorical-histogram E2E tests
  // Lives in its own project so the existing smoke-test-project isn't polluted
  // with the 3.8K metric rows / 36-sibling prefix family the bars tests need.
  console.log('\n1️⃣1️⃣d Seeding bars-test-project (metrics + dashboard)...');

  const barsProject = projects[4]; // 'bars-test-project'
  const BARS_RUN_NAMES = ['bars-run-A', 'bars-run-B', 'bars-run-C'];
  const CATEGORICAL_SUFFIXES = ['classA', 'classB', 'classC', 'classD', 'classE'];
  const CATEGORICAL_BIG_COUNT = 36; // >30 forces the X-axis label threshold (test 4)
  const BARS_STEPS = Array.from({ length: 30 }, (_, i) => i); // 0..29
  const OUTLIER_STEP = 20;
  const OUTLIER_RUN_NAME = 'bars-run-C';

  const barsRuns: { id: bigint; name: string; createdAt: Date }[] = [];
  for (const runName of BARS_RUN_NAMES) {
    let run = await prisma.runs.findFirst({
      where: { projectId: barsProject.id, organizationId: org.id, name: runName },
      select: { id: true, name: true, createdAt: true },
    });
    if (!run) {
      // Backdate so these runs aren't auto-selected by other tests that pick
      // newest runs.
      const createdAt = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000);
      run = await prisma.runs.create({
        data: {
          name: runName,
          organizationId: org.id,
          projectId: barsProject.id,
          createdById: user.id,
          creatorApiKeyId: apiKey.id,
          status: 'COMPLETED',
          config: { epochs: 30, lr: 0.001 },
          systemMetadata: { hostname: 'bars-test-host', python: '3.11' },
          createdAt,
          updatedAt: createdAt,
        },
        select: { id: true, name: true, createdAt: true },
      });
      console.log(`   ✓ Created bars-test run ${runName} (ID: ${run.id})`);
    }
    barsRuns.push(run);
  }

  // Register RunLogs for every metric these tests reference
  const barsLogData: { runId: bigint; logName: string; logGroup: string; logType: 'METRIC' | 'HISTOGRAM' }[] = [];
  for (const run of barsRuns) {
    for (const suffix of CATEGORICAL_SUFFIXES) {
      barsLogData.push({ runId: run.id, logName: `categorical/${suffix}`, logGroup: 'categorical', logType: 'METRIC' });
    }
    for (let i = 1; i <= CATEGORICAL_BIG_COUNT; i++) {
      const suffix = `c${String(i).padStart(2, '0')}`;
      barsLogData.push({ runId: run.id, logName: `categorical_big/${suffix}`, logGroup: 'categorical_big', logType: 'METRIC' });
    }
    barsLogData.push({ runId: run.id, logName: 'distributions/weights', logGroup: 'distributions', logType: 'HISTOGRAM' });
    barsLogData.push({ runId: run.id, logName: 'train/loss', logGroup: 'train', logType: 'METRIC' });
  }
  await prisma.runLogs.createMany({ data: barsLogData, skipDuplicates: true });
  console.log(`   ✓ Registered ${barsLogData.length} bars-test runLog entries`);

  // ClickHouse data — scalar metrics + numeric histogram bins
  const barsClickhouseUrl = process.env.CLICKHOUSE_URL;
  if (barsClickhouseUrl) {
    const barsCh = createClient({
      url: barsClickhouseUrl,
      username: process.env.CLICKHOUSE_USER || 'default',
      password: process.env.CLICKHOUSE_PASSWORD || '',
    });

    const barsMetricRows: Record<string, unknown>[] = [];
    const barsHistRows: Record<string, unknown>[] = [];

    for (const run of barsRuns) {
      const baseTime = run.createdAt.getTime();
      const isOutlierRun = run.name === OUTLIER_RUN_NAME;
      const runIdx = BARS_RUN_NAMES.indexOf(run.name);

      for (const step of BARS_STEPS) {
        const isOutlierStep = isOutlierRun && step === OUTLIER_STEP;
        const tsStr = new Date(baseTime + step * 1000).toISOString().replace('T', ' ').replace('Z', '');

        // categorical/* — 5 siblings, the workhorse bars widget data
        for (let i = 0; i < CATEGORICAL_SUFFIXES.length; i++) {
          const suffix = CATEGORICAL_SUFFIXES[i];
          const base = 10 + 5 * Math.sin(step / 5 + i + runIdx * 0.7) + 2 * runIdx;
          const value = isOutlierStep ? base * 1000 : base;
          barsMetricRows.push({
            tenantId: org.id,
            projectName: barsProject.name,
            runId: Number(run.id),
            logGroup: 'categorical',
            logName: `categorical/${suffix}`,
            time: tsStr,
            step,
            value,
          });
        }

        // categorical_big/* — 36 siblings, drives the >30-label X-axis path
        for (let i = 1; i <= CATEGORICAL_BIG_COUNT; i++) {
          const suffix = `c${String(i).padStart(2, '0')}`;
          const base = 5 + 3 * Math.cos(step / 4 + i * 0.3);
          const value = isOutlierStep ? base * 500 : base;
          barsMetricRows.push({
            tenantId: org.id,
            projectName: barsProject.name,
            runId: Number(run.id),
            logGroup: 'categorical_big',
            logName: `categorical_big/${suffix}`,
            time: tsStr,
            step,
            value,
          });
        }

        // train/loss line metric (used by the mixed line+bars widget)
        barsMetricRows.push({
          tenantId: org.id,
          projectName: barsProject.name,
          runId: Number(run.id),
          logGroup: 'train',
          logName: 'train/loss',
          time: tsStr,
          step,
          value: 1 - step / 30 + Math.sin(step + runIdx) * 0.05,
        });

        // distributions/weights numeric histogram — for tests 6 + 10
        const std = 0.5 * Math.exp(-step / 30) + 0.05;
        const numBins = 30;
        // Outlier step blows out min/max so the IQR fence is visually obvious
        const min = isOutlierStep ? -60 : -3 * std;
        const max = isOutlierStep ? 60 : 3 * std;
        const freq: number[] = [];
        for (let b = 0; b < numBins; b++) {
          const center = min + (max - min) * (b + 0.5) / numBins;
          const density = Math.exp(-0.5 * (center / std) ** 2) / (std * Math.sqrt(2 * Math.PI));
          freq.push(Math.round(density * 1000 * (1 + 0.1 * Math.sin(runIdx + b))));
        }
        const maxFreq = Math.max(...freq);
        const histData = JSON.stringify({
          freq,
          bins: { min: parseFloat(min.toFixed(6)), max: parseFloat(max.toFixed(6)), num: numBins },
          shape: 'uniform',
          type: 'Histogram',
          maxFreq,
        });
        barsHistRows.push({
          tenantId: org.id,
          projectName: barsProject.name,
          runId: Number(run.id),
          logGroup: 'distributions',
          logName: 'distributions/weights',
          dataType: 'histogram',
          time: tsStr,
          step,
          data: histData,
        });
      }
    }

    if (barsMetricRows.length > 0) {
      await barsCh.insert({ table: 'mlop_metrics', values: barsMetricRows, format: 'JSONEachRow' });
      console.log(`   ✓ Inserted ${barsMetricRows.length} bars-test metric rows`);
    }
    if (barsHistRows.length > 0) {
      await barsCh.insert({ table: 'mlop_data', values: barsHistRows, format: 'JSONEachRow' });
      console.log(`   ✓ Inserted ${barsHistRows.length} bars-test histogram rows`);
    }
    await barsCh.close();
  } else {
    console.log('   ⚠ CLICKHOUSE_URL not set, skipping bars-test ClickHouse seeding');
  }

  // Distributions Test dashboard (the seeded name "Bars Variants Test" is
  // preserved to avoid renaming churn in lookups). One static section with
  // 6 widgets covering every distributions variant the E2E specs reach for,
  // plus a dynamic section that emits distributions via the `*{bars}*`
  // glob — exercises the dynamic-section bars-surfacing path.
  const barsDashboardConfig = {
    version: 1,
    sections: [
      {
        id: 'bars-dynamic-section',
        name: 'Bars Variants (Dynamic)',
        collapsed: false,
        widgets: [],
        // Glob matches the encoded `categorical/{bars}` + `categorical_big/{bars}`
        // entries that use-dynamic-section pushes into mergedMetrics when
        // patternTargetsBars is true.
        dynamicPattern: '*{bars}*',
        dynamicPatternMode: 'search',
      },
      {
        id: 'bars-static-section',
        name: 'Bars Variants (Static)',
        collapsed: false,
        widgets: [
          {
            // W1: single bars distributions over the 5-sibling
            // categorical/ prefix.
            id: 'bars-w1-single-categorical',
            type: 'distributions',
            config: {
              entries: [
                {
                  kind: 'bars',
                  prefix: 'categorical/',
                  viewMode: 'step',
                  depthAxis: 'step',
                  ignoreOutliers: true,
                  stepsOnX: false,
                },
              ],
            },
            layout: { x: 0, y: 0, w: 6, h: 5 },
          },
          {
            // W2: single bars distributions over the 36-sibling
            // categorical_big/ prefix — forces the >30 X-axis-label threshold.
            id: 'bars-w2-single-big',
            type: 'distributions',
            config: {
              entries: [
                {
                  kind: 'bars',
                  prefix: 'categorical_big/',
                  viewMode: 'step',
                  depthAxis: 'step',
                  ignoreOutliers: true,
                  stepsOnX: false,
                },
              ],
            },
            layout: { x: 6, y: 0, w: 6, h: 5 },
          },
          {
            // W3: multi-entry distributions — two bars entries in one
            // widget. Drives the per-entry fullscreen + multi-panel
            // scrolling tests.
            id: 'bars-w3-multi-panel',
            type: 'distributions',
            config: {
              entries: [
                {
                  kind: 'bars',
                  prefix: 'categorical/',
                  viewMode: 'step',
                  depthAxis: 'step',
                  ignoreOutliers: true,
                  stepsOnX: false,
                },
                {
                  kind: 'bars',
                  prefix: 'categorical_big/',
                  viewMode: 'step',
                  depthAxis: 'step',
                  ignoreOutliers: true,
                  stepsOnX: false,
                },
              ],
            },
            layout: { x: 0, y: 5, w: 6, h: 5 },
          },
          {
            // W4: mixed distributions — one bars entry + one histogram
            // entry. Used to verify the multi-entry widget shape works
            // across both kinds in a single widget. (Replaces the old
            // chart-with-mixed-line-and-bars shape which no longer
            // exists; line + bars are now separate widgets.)
            id: 'bars-w4-mixed-distributions',
            type: 'distributions',
            config: {
              entries: [
                {
                  kind: 'bars',
                  prefix: 'categorical/',
                  viewMode: 'step',
                  depthAxis: 'step',
                  ignoreOutliers: true,
                  stepsOnX: false,
                },
                {
                  kind: 'histogram',
                  metric: 'distributions/weights',
                  viewMode: 'step',
                  ignoreOutliers: true,
                  stepsOnX: false,
                },
              ],
            },
            layout: { x: 6, y: 5, w: 6, h: 5 },
          },
          {
            // W5: single numeric histogram distributions — drives the
            // IQR fence and PNG export tests for the histogram path.
            id: 'bars-w5-histogram',
            type: 'distributions',
            config: {
              entries: [
                {
                  kind: 'histogram',
                  metric: 'distributions/weights',
                  viewMode: 'step',
                  ignoreOutliers: true,
                  stepsOnX: false,
                },
              ],
            },
            layout: { x: 0, y: 10, w: 6, h: 5 },
          },
          {
            // W6: line-only chart widget — control case for outer-toolbar
            // tests (all three buttons present).
            id: 'bars-w6-line-only',
            type: 'chart',
            config: {
              metrics: ['train/loss'],
              xAxis: 'step',
              yAxisScale: 'linear',
              xAxisScale: 'linear',
              aggregation: 'LAST',
              showOriginal: false,
            },
            layout: { x: 6, y: 10, w: 6, h: 5 },
          },
        ],
      },
    ],
    settings: { gridCols: 12, rowHeight: 80, compactType: 'vertical' },
  };

  await prisma.dashboardView.upsert({
    where: {
      organizationId_projectId_name: {
        organizationId: org.id,
        projectId: barsProject.id,
        name: 'Bars Variants Test',
      },
    },
    update: { config: barsDashboardConfig },
    create: {
      name: 'Bars Variants Test',
      organizationId: org.id,
      projectId: barsProject.id,
      createdById: user.id,
      isDefault: false,
      config: barsDashboardConfig,
    },
  });
  console.log('   ✓ Created Bars Variants Test dashboard view');

  // 11c. Create "Line Chart Variants Test" dashboard view with all metric widget combos
  console.log('\n1️⃣1️⃣c Creating Line Chart Variants Test dashboard view...');

  const lineChartVariantsDashboardConfig = {
    version: 1,
    sections: [
      {
        id: 'linechart-dynamic-section',
        name: 'Train Metrics (Dynamic)',
        collapsed: false,
        widgets: [],
        dynamicPattern: 'train/*',
        dynamicPatternMode: 'search',
      },
      {
        id: 'linechart-static-section',
        name: 'Chart Widget Variants (Static)',
        collapsed: false,
        widgets: [
          {
            id: 'linechart-static-multimetric',
            type: 'chart',
            config: {
              title: 'Static multi-metric',
              metrics: ['train/metric_00', 'train/metric_01', 'train/metric_02'],
              xAxis: 'step',
              yAxisScale: 'linear',
              xAxisScale: 'linear',
              aggregation: 'LAST',
              showOriginal: false,
            },
            layout: { x: 0, y: 0, w: 6, h: 4 },
          },
          {
            id: 'linechart-dynamic-multimetric',
            type: 'chart',
            config: {
              title: 'Dynamic multi-metric',
              // glob:train/metric_0[0-2] isn't supported — use regex instead
              metrics: ['regex:^train/metric_0[0-2]$'],
              xAxis: 'step',
              yAxisScale: 'linear',
              xAxisScale: 'linear',
              aggregation: 'LAST',
              showOriginal: false,
            },
            layout: { x: 6, y: 0, w: 6, h: 4 },
          },
          {
            id: 'linechart-static-singlemetric',
            type: 'chart',
            config: {
              title: 'Static single-metric',
              metrics: ['train/metric_10'],
              xAxis: 'step',
              yAxisScale: 'linear',
              xAxisScale: 'linear',
              aggregation: 'LAST',
              showOriginal: false,
            },
            layout: { x: 0, y: 4, w: 6, h: 4 },
          },
          {
            id: 'linechart-dynamic-singlemetric',
            type: 'chart',
            config: {
              title: 'Dynamic single-metric',
              // Must match exactly 1 metric — train/metric_10 only
              metrics: ['regex:^train/metric_10$'],
              xAxis: 'step',
              yAxisScale: 'linear',
              xAxisScale: 'linear',
              aggregation: 'LAST',
              showOriginal: false,
            },
            layout: { x: 6, y: 4, w: 6, h: 4 },
          },
        ],
      },
    ],
    settings: { gridCols: 12, rowHeight: 80, compactType: 'vertical' },
  };

  await prisma.dashboardView.upsert({
    where: {
      organizationId_projectId_name: {
        organizationId: org.id,
        projectId: project.id,
        name: 'Line Chart Variants Test',
      },
    },
    update: { config: lineChartVariantsDashboardConfig },
    create: {
      name: 'Line Chart Variants Test',
      organizationId: org.id,
      projectId: project.id,
      createdById: user.id,
      isDefault: false,
      config: lineChartVariantsDashboardConfig,
    },
  });
  console.log('   ✓ Created Line Chart Variants Test dashboard view');

  // --- Zoom Visibility Test dashboard ---
  const zoomVisibilityDashboardConfig = {
    version: 1,
    sections: [
      {
        id: 'zoom-vis-static-section',
        name: 'Zoom Visibility Charts (Static)',
        collapsed: false,
        widgets: [
          {
            id: 'zoom-vis-loss-widget',
            type: 'chart',
            config: {
              title: 'train/loss (different step counts)',
              metrics: ['train/loss'],
              xAxis: 'step',
              yAxisScale: 'linear',
              xAxisScale: 'linear',
            },
            layout: { x: 0, y: 0, w: 12, h: 4 },
          },
        ],
      },
      {
        id: 'zoom-vis-dynamic-section',
        name: 'Zoom Visibility Metrics (Dynamic)',
        collapsed: false,
        widgets: [],
        dynamicPattern: 'train/*',
        dynamicPatternMode: 'search',
      },
    ],
    settings: { gridCols: 12, rowHeight: 80, compactType: 'vertical' },
  };

  await prisma.dashboardView.upsert({
    where: {
      organizationId_projectId_name: {
        organizationId: org.id,
        projectId: project.id,
        name: 'Zoom Visibility Test',
      },
    },
    update: { config: zoomVisibilityDashboardConfig },
    create: {
      name: 'Zoom Visibility Test',
      organizationId: org.id,
      projectId: project.id,
      createdById: user.id,
      isDefault: false,
      config: zoomVisibilityDashboardConfig,
    },
  });
  console.log('   ✓ Created Zoom Visibility Test dashboard view');

  // --- Search False Positive Test dashboard ---
  const searchFalsePositiveDashboardConfig = {
    version: 1,
    sections: [
      {
        id: 'search-fp-unique-section',
        name: 'Unique Metric Section',
        collapsed: false,
        widgets: [
          {
            id: 'search-fp-unique-widget',
            type: 'chart',
            config: {
              title: 'train/metric_49 (unique)',
              metrics: ['train/metric_49'],
              xAxis: 'step',
              yAxisScale: 'linear',
              xAxisScale: 'linear',
            },
            layout: { x: 0, y: 0, w: 12, h: 4 },
          },
        ],
      },
      {
        id: 'search-fp-dynamic-train',
        name: 'Train Metrics (Dynamic)',
        collapsed: false,
        widgets: [],
        dynamicPattern: 'train/metric_0*',
        dynamicPatternMode: 'search',
      },
      {
        id: 'search-fp-dynamic-other',
        name: 'Other Metrics (Dynamic)',
        collapsed: false,
        widgets: [],
        dynamicPattern: 'train/metric_1*',
        dynamicPatternMode: 'search',
      },
    ],
    settings: { gridCols: 12, rowHeight: 80, compactType: 'vertical' },
  };

  await prisma.dashboardView.upsert({
    where: {
      organizationId_projectId_name: {
        organizationId: org.id,
        projectId: project.id,
        name: 'Search False Positive Test',
      },
    },
    update: { config: searchFalsePositiveDashboardConfig },
    create: {
      name: 'Search False Positive Test',
      organizationId: org.id,
      projectId: project.id,
      createdById: user.id,
      isDefault: false,
      config: searchFalsePositiveDashboardConfig,
    },
  });
  console.log('   ✓ Created Search False Positive Test dashboard view');

  // 13. Seed image and file data for file-viewer and step-sync E2E tests
  console.log('\n1️⃣3️⃣ Seeding image and file data...');

  const storageEndpoint = process.env.STORAGE_ENDPOINT;
  const storageAccessKey = process.env.STORAGE_ACCESS_KEY_ID;
  const storageSecretKey = process.env.STORAGE_SECRET_ACCESS_KEY;
  const storageBucket = process.env.STORAGE_BUCKET;
  const storageRegion = process.env.STORAGE_REGION || 'us-east-1';
  const clickhouseUrlForFiles = process.env.CLICKHOUSE_URL;
  const clickhouseUserForFiles = process.env.CLICKHOUSE_USER || 'default';
  const clickhousePasswordForFiles = process.env.CLICKHOUSE_PASSWORD || '';

  if (clickhouseUrlForFiles && storageEndpoint && storageAccessKey && storageSecretKey && storageBucket) {
    const s3 = new S3Client({
      endpoint: storageEndpoint,
      region: storageRegion,
      credentials: {
        accessKeyId: storageAccessKey,
        secretAccessKey: storageSecretKey,
      },
      forcePathStyle: true,
    });

    const chForFiles = createClient({
      url: clickhouseUrlForFiles,
      username: clickhouseUserForFiles,
      password: clickhousePasswordForFiles,
    });

    // Use first 5 bulk runs for image/file seeding
    const fileSeedRuns = await prisma.runs.findMany({
      where: {
        projectId: project.id,
        organizationId: org.id,
        name: { startsWith: 'bulk-run-' },
      },
      select: { id: true, name: true, createdAt: true },
      orderBy: { name: 'asc' },
      take: 5,
    });

    if (fileSeedRuns.length > 0) {
      const imageSteps = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100];

      // Create RunLogs entries for IMAGE and TEXT logs
      const fileRunLogData = fileSeedRuns.flatMap((run) => [
        {
          runId: run.id,
          logName: 'media/training_samples',
          logGroup: 'media',
          logType: 'IMAGE' as const,
        },
        {
          runId: run.id,
          logName: 'logs/training.log',
          logGroup: 'logs',
          logType: 'TEXT' as const,
        },
      ]);
      await prisma.runLogs.createMany({
        data: fileRunLogData,
        skipDuplicates: true,
      });
      console.log(`   ✓ Registered IMAGE and TEXT log names for ${fileSeedRuns.length} runs`);

      // Insert ClickHouse mlop_files rows and upload to S3
      const imageFileRows: Record<string, unknown>[] = [];
      const textFileRows: Record<string, unknown>[] = [];
      const s3Uploads: Promise<unknown>[] = [];

      for (const run of fileSeedRuns) {
        const baseTime = run.createdAt.getTime();

        // Image files: 11 steps
        for (const step of imageSteps) {
          const fileName = `step_${String(step).padStart(5, '0')}.png`;
          // Vary color by step for variety
          const png = createSimplePNG(8, 8, (step * 25) % 256, 100, 150);
          const s3Key = `${org.id}/${project.name}/${run.id}/media/training_samples/${fileName}`;

          imageFileRows.push({
            tenantId: org.id,
            projectName: project.name,
            runId: Number(run.id),
            logGroup: 'media',
            logName: 'media/training_samples',
            time: new Date(baseTime + step * 1000)
              .toISOString()
              .replace('T', ' ')
              .replace('Z', ''),
            step,
            fileName,
            fileType: 'image/png',
            fileSize: png.length,
          });

          s3Uploads.push(
            s3.send(
              new PutObjectCommand({
                Bucket: storageBucket,
                Key: s3Key,
                Body: png,
                ContentType: 'image/png',
              }),
            ),
          );
        }

        // Text file: 1 file per run at step 0
        const logContent = `Training log for run ${run.name}\nEpoch 1: loss=0.5\nEpoch 2: loss=0.3\nTraining complete.\n`;
        const logBuffer = Buffer.from(logContent, 'utf-8');
        const textFileName = 'training_run.log';
        const textS3Key = `${org.id}/${project.name}/${run.id}/logs/training.log/${textFileName}`;

        textFileRows.push({
          tenantId: org.id,
          projectName: project.name,
          runId: Number(run.id),
          logGroup: 'logs',
          logName: 'logs/training.log',
          time: new Date(baseTime).toISOString().replace('T', ' ').replace('Z', ''),
          step: 0,
          fileName: textFileName,
          fileType: 'text/plain',
          fileSize: logBuffer.length,
        });

        s3Uploads.push(
          s3.send(
            new PutObjectCommand({
              Bucket: storageBucket,
              Key: textS3Key,
              Body: logBuffer,
              ContentType: 'text/plain',
            }),
          ),
        );

        // Captioned media samples (linum feedback #6): one image WITH a
        // caption and one WITHOUT, under a dedicated logName. The smoke test
        // queries `media/captioned_samples` and asserts the caption survives
        // the ingest→ClickHouse→backend path (and is null when absent).
        const captionLogName = 'media/captioned_samples';
        const captionLogGroup = 'media';
        const captionedSamples = [
          { step: 0, caption: 'ground truth vs prediction' },
          { step: 1, caption: null as string | null },
        ];
        for (const { step, caption } of captionedSamples) {
          const fileName = `captioned_step_${String(step).padStart(5, '0')}.png`;
          const png = createSimplePNG(8, 8, (step * 40) % 256, 120, 200);
          const s3Key = `${org.id}/${project.name}/${run.id}/${captionLogName}/${fileName}`;
          imageFileRows.push({
            tenantId: org.id,
            projectName: project.name,
            runId: Number(run.id),
            logGroup: captionLogGroup,
            logName: captionLogName,
            time: new Date(baseTime + step * 1000)
              .toISOString()
              .replace('T', ' ')
              .replace('Z', ''),
            step,
            fileName,
            fileType: 'image/png',
            fileSize: png.length,
            caption,
          });
          s3Uploads.push(
            s3.send(
              new PutObjectCommand({
                Bucket: storageBucket,
                Key: s3Key,
                Body: png,
                ContentType: 'image/png',
              }),
            ),
          );
        }

        // Multi-sample-per-step media whose fileName order is the REVERSE of
        // the logged (sampleIndex) order — lets the smoke test prove the read
        // path sorts by sampleIndex, not fileName. All four share step 0, so
        // sampleIndex is the only thing that can produce the correct order.
        const orderLogName = 'media/order_samples';
        const orderSamples = [
          { sampleIndex: 0, fileName: 'order_d.png' },
          { sampleIndex: 1, fileName: 'order_c.png' },
          { sampleIndex: 2, fileName: 'order_b.png' },
          { sampleIndex: 3, fileName: 'order_a.png' },
        ];
        for (const { sampleIndex, fileName } of orderSamples) {
          const png = createSimplePNG(8, 8, (sampleIndex * 60) % 256, 90, 160);
          const s3Key = `${org.id}/${project.name}/${run.id}/${orderLogName}/${fileName}`;
          imageFileRows.push({
            tenantId: org.id,
            projectName: project.name,
            runId: Number(run.id),
            logGroup: 'media',
            logName: orderLogName,
            time: new Date(baseTime).toISOString().replace('T', ' ').replace('Z', ''),
            step: 0,
            fileName,
            fileType: 'image/png',
            fileSize: png.length,
            caption: null as string | null,
            sampleIndex,
          });
          s3Uploads.push(
            s3.send(
              new PutObjectCommand({
                Bucket: storageBucket,
                Key: s3Key,
                Body: png,
                ContentType: 'image/png',
              }),
            ),
          );
        }
      }

      // Register the captioned-samples IMAGE log so it appears in run logs.
      await prisma.runLogs.createMany({
        data: fileSeedRuns.map((run) => ({
          runId: run.id,
          logName: 'media/captioned_samples',
          logGroup: 'media',
          logType: 'IMAGE' as const,
        })),
        skipDuplicates: true,
      });

      // Register the order-samples IMAGE log (sampleIndex ordering fixture).
      await prisma.runLogs.createMany({
        data: fileSeedRuns.map((run) => ({
          runId: run.id,
          logName: 'media/order_samples',
          logGroup: 'media',
          logType: 'IMAGE' as const,
        })),
        skipDuplicates: true,
      });

      // Insert ClickHouse rows
      if (imageFileRows.length > 0) {
        await chForFiles.insert({
          table: 'mlop_files',
          values: imageFileRows,
          format: 'JSONEachRow',
        });
        console.log(`   ✓ Inserted ${imageFileRows.length} image file rows into ClickHouse`);
      }

      if (textFileRows.length > 0) {
        await chForFiles.insert({
          table: 'mlop_files',
          values: textFileRows,
          format: 'JSONEachRow',
        });
        console.log(`   ✓ Inserted ${textFileRows.length} text file rows into ClickHouse`);
      }

      // Upload all files to S3
      await Promise.all(s3Uploads);
      console.log(`   ✓ Uploaded ${s3Uploads.length} files to S3/MinIO`);

      await chForFiles.close();
    } else {
      console.log('   ⚠ No bulk runs found for file seeding');
    }
  } else {
    console.log(
      '   ⚠ Missing CLICKHOUSE_URL or STORAGE_* env vars, skipping image/file seeding',
    );
  }

  // 13. Seed media-rich data (histograms, images, audio, video) for a-bulk-run-011..013
  // These 3 runs are guaranteed to have ALL media types, enabling reliable E2E tests
  // across all 6 visualization locations without randomness issues.
  console.log('\n1️⃣3️⃣ Seeding media-rich data for a-bulk-run-011..013...');

  const mediaStorageEndpoint = process.env.STORAGE_ENDPOINT;
  const mediaStorageAccessKey = process.env.STORAGE_ACCESS_KEY_ID;
  const mediaStorageSecretKey = process.env.STORAGE_SECRET_ACCESS_KEY;
  const mediaStorageBucket = process.env.STORAGE_BUCKET;
  const mediaStorageRegion = process.env.STORAGE_REGION || 'us-east-1';
  const mediaClickhouseUrl = process.env.CLICKHOUSE_URL;
  const mediaClickhouseUser = process.env.CLICKHOUSE_USER || 'default';
  const mediaClickhousePassword = process.env.CLICKHOUSE_PASSWORD || '';

  if (mediaClickhouseUrl && mediaStorageEndpoint && mediaStorageAccessKey && mediaStorageSecretKey && mediaStorageBucket) {
    const mediaS3 = new S3Client({
      endpoint: mediaStorageEndpoint,
      region: mediaStorageRegion,
      credentials: {
        accessKeyId: mediaStorageAccessKey,
        secretAccessKey: mediaStorageSecretKey,
      },
      forcePathStyle: true,
    });

    const mediaCh = createClient({
      url: mediaClickhouseUrl,
      username: mediaClickhouseUser,
      password: mediaClickhousePassword,
    });

    // Fetch a-bulk-run-011 through a-bulk-run-013
    const mediaRuns = await prisma.runs.findMany({
      where: {
        projectId: project.id,
        organizationId: org.id,
        name: { in: Array.from({ length: 3 }, (_, i) => `a-bulk-run-${String(i + 11).padStart(3, '0')}`) },
      },
      select: { id: true, name: true, createdAt: true },
      orderBy: { name: 'asc' },
    });

    if (mediaRuns.length > 0) {
      // --- RunLogs entries for all media types (2 groups each) ---
      const mediaRunLogData = mediaRuns.flatMap((run) => [
        // Histograms
        { runId: run.id, logName: 'distributions/weights', logGroup: 'distributions', logType: 'HISTOGRAM' as const },
        { runId: run.id, logName: 'distributions/gradients', logGroup: 'distributions', logType: 'HISTOGRAM' as const },
        // Images
        { runId: run.id, logName: 'images/training_viz', logGroup: 'images', logType: 'IMAGE' as const },
        { runId: run.id, logName: 'images/attention_maps', logGroup: 'images', logType: 'IMAGE' as const },
        // Audio
        { runId: run.id, logName: 'audio/tone_sample', logGroup: 'audio', logType: 'AUDIO' as const },
        { runId: run.id, logName: 'audio/speech_sample', logGroup: 'audio', logType: 'AUDIO' as const },
        // Video
        { runId: run.id, logName: 'video/animation', logGroup: 'video', logType: 'VIDEO' as const },
        { runId: run.id, logName: 'video/reconstruction', logGroup: 'video', logType: 'VIDEO' as const },
        // Captioned, multi-sample video (two samples per step, each with a
        // user-supplied caption). Exercises the single-run 2-up grid + the
        // caption label, which regressed (caption clipped by overflow-hidden).
        { runId: run.id, logName: 'video/captioned_pair', logGroup: 'video', logType: 'VIDEO' as const },
      ]);
      await prisma.runLogs.createMany({ data: mediaRunLogData, skipDuplicates: true });
      console.log(`   ✓ Registered 9 media log names for ${mediaRuns.length} runs`);

      // --- Histogram data (mlop_data) ---
      // Steps: every 3rd epoch from 0-27 = [0, 3, 6, 9, 12, 15, 18, 21, 24, 27]
      const histogramSteps = Array.from({ length: 10 }, (_, i) => i * 3);
      const histogramRows: Record<string, unknown>[] = [];

      for (const run of mediaRuns) {
        const baseTime = run.createdAt.getTime();
        const runIdx = parseInt(run.name.replace(/.*bulk-run-/, ''), 10);

        for (const step of histogramSteps) {
          const t = step / 27; // normalized progress
          for (const logName of ['distributions/weights', 'distributions/gradients']) {
            const isWeights = logName.includes('weights');
            const std = isWeights ? 0.5 * Math.exp(-t) + 0.02 : 1.0 * Math.exp(-2 * t) + 0.01;
            // Generate histogram bins
            const numBins = 30;
            const min = -3 * std;
            const max = 3 * std;
            const freq: number[] = [];
            for (let b = 0; b < numBins; b++) {
              const binCenter = min + (max - min) * (b + 0.5) / numBins;
              // Gaussian-shaped frequency
              const density = Math.exp(-0.5 * (binCenter / std) ** 2) / (std * Math.sqrt(2 * Math.PI));
              freq.push(Math.round(density * 1000 * (1 + 0.1 * Math.sin(runIdx + b))));
            }
            const maxFreq = Math.max(...freq);

            const histData = JSON.stringify({
              freq,
              bins: { min: parseFloat(min.toFixed(6)), max: parseFloat(max.toFixed(6)), num: numBins },
              shape: 'uniform',
              type: 'Histogram',
              maxFreq,
            });

            histogramRows.push({
              tenantId: org.id,
              projectName: project.name,
              runId: Number(run.id),
              logGroup: 'distributions',
              logName,
              dataType: 'histogram',
              time: new Date(baseTime + step * 1000).toISOString().replace('T', ' ').replace('Z', ''),
              step,
              data: histData,
            });
          }
        }
      }

      if (histogramRows.length > 0) {
        await mediaCh.insert({ table: 'mlop_data', values: histogramRows, format: 'JSONEachRow' });
        console.log(`   ✓ Inserted ${histogramRows.length} histogram rows into ClickHouse`);
      }

      // --- Image files (mlop_files + S3) ---
      // Steps: every 5th epoch from 0-25 = [0, 5, 10, 15, 20, 25]
      const imageStepsMedia = [0, 5, 10, 15, 20, 25];
      const imageFileRows: Record<string, unknown>[] = [];
      const mediaS3Uploads: Promise<unknown>[] = [];

      for (const run of mediaRuns) {
        const baseTime = run.createdAt.getTime();
        const runIdx = parseInt(run.name.replace(/.*bulk-run-/, ''), 10);

        for (const logName of ['images/training_viz', 'images/attention_maps']) {
          const logGroup = 'images';
          for (const step of imageStepsMedia) {
            const fileName = `epoch_${String(step).padStart(3, '0')}.png`;
            const r = (step * 40 + runIdx * 20) % 256;
            const g = (100 + step * 10) % 256;
            const b = (150 + runIdx * 30) % 256;
            const png = createSimplePNG(16, 16, r, g, b);
            const s3Key = `${org.id}/${project.name}/${run.id}/${logName}/${fileName}`;

            imageFileRows.push({
              tenantId: org.id,
              projectName: project.name,
              runId: Number(run.id),
              logGroup,
              logName,
              time: new Date(baseTime + step * 1000).toISOString().replace('T', ' ').replace('Z', ''),
              step,
              fileName,
              fileType: 'image/png',
              fileSize: png.length,
            });

            mediaS3Uploads.push(
              mediaS3.send(new PutObjectCommand({
                Bucket: mediaStorageBucket,
                Key: s3Key,
                Body: png,
                ContentType: 'image/png',
              })),
            );
          }
        }
      }

      if (imageFileRows.length > 0) {
        await mediaCh.insert({ table: 'mlop_files', values: imageFileRows, format: 'JSONEachRow' });
        console.log(`   ✓ Inserted ${imageFileRows.length} image file rows into ClickHouse`);
      }

      // --- Audio files (mlop_files + S3) ---
      // Steps: every 10th epoch from 0-20 = [0, 10, 20]
      const audioSteps = [0, 10, 20];
      const audioFileRows: Record<string, unknown>[] = [];

      for (const run of mediaRuns) {
        const baseTime = run.createdAt.getTime();
        const runIdx = parseInt(run.name.replace(/.*bulk-run-/, ''), 10);

        for (const logName of ['audio/tone_sample', 'audio/speech_sample']) {
          const logGroup = 'audio';
          for (const step of audioSteps) {
            const fileName = `step_${String(step).padStart(3, '0')}.wav`;
            // Create minimal WAV file (44-byte header + 1600 samples of 16-bit mono @ 16kHz = 0.1s)
            const sampleRate = 16000;
            const numSamples = 1600;
            const freq = 220 + step * 20 + runIdx * 10;
            const wavHeader = Buffer.alloc(44);
            // RIFF header
            wavHeader.write('RIFF', 0);
            wavHeader.writeUInt32LE(36 + numSamples * 2, 4);
            wavHeader.write('WAVE', 8);
            // fmt chunk
            wavHeader.write('fmt ', 12);
            wavHeader.writeUInt32LE(16, 16); // chunk size
            wavHeader.writeUInt16LE(1, 20); // PCM
            wavHeader.writeUInt16LE(1, 22); // mono
            wavHeader.writeUInt32LE(sampleRate, 24);
            wavHeader.writeUInt32LE(sampleRate * 2, 28); // byte rate
            wavHeader.writeUInt16LE(2, 32); // block align
            wavHeader.writeUInt16LE(16, 34); // bits per sample
            // data chunk
            wavHeader.write('data', 36);
            wavHeader.writeUInt32LE(numSamples * 2, 40);

            const samples = Buffer.alloc(numSamples * 2);
            for (let i = 0; i < numSamples; i++) {
              const val = Math.round(16000 * Math.sin(2 * Math.PI * freq * i / sampleRate));
              samples.writeInt16LE(Math.max(-32768, Math.min(32767, val)), i * 2);
            }
            const wav = Buffer.concat([wavHeader, samples]);
            const s3Key = `${org.id}/${project.name}/${run.id}/${logName}/${fileName}`;

            audioFileRows.push({
              tenantId: org.id,
              projectName: project.name,
              runId: Number(run.id),
              logGroup,
              logName,
              time: new Date(baseTime + step * 1000).toISOString().replace('T', ' ').replace('Z', ''),
              step,
              fileName,
              fileType: 'audio/wav',
              fileSize: wav.length,
            });

            mediaS3Uploads.push(
              mediaS3.send(new PutObjectCommand({
                Bucket: mediaStorageBucket,
                Key: s3Key,
                Body: wav,
                ContentType: 'audio/wav',
              })),
            );
          }
        }
      }

      if (audioFileRows.length > 0) {
        await mediaCh.insert({ table: 'mlop_files', values: audioFileRows, format: 'JSONEachRow' });
        console.log(`   ✓ Inserted ${audioFileRows.length} audio file rows into ClickHouse`);
      }

      // --- Video files (mlop_files + S3) ---
      // Steps: [0, 10, 20]
      const videoSteps = [0, 10, 20];
      const videoFileRows: Record<string, unknown>[] = [];

      // Build a minimal valid MP4 stub (ftyp + mdat boxes). Browsers can't
      // play it but the file viewer renders the entry + caption.
      const makeMp4Stub = () => {
        const ftyp = Buffer.from([
          0x00, 0x00, 0x00, 0x14, // box size: 20
          0x66, 0x74, 0x79, 0x70, // 'ftyp'
          0x69, 0x73, 0x6f, 0x6d, // 'isom'
          0x00, 0x00, 0x02, 0x00, // minor version
          0x69, 0x73, 0x6f, 0x6d, // compatible brand
        ]);
        const mdatContent = Buffer.alloc(8);
        mdatContent.write('mdat', 4);
        mdatContent.writeUInt32BE(8, 0);
        return Buffer.concat([ftyp, mdatContent]);
      };

      const pushVideoFile = (
        run: (typeof mediaRuns)[number],
        logName: string,
        step: number,
        fileName: string,
        caption: string | null,
      ) => {
        const baseTime = run.createdAt.getTime();
        const mp4 = makeMp4Stub();
        const s3Key = `${org.id}/${project.name}/${run.id}/${logName}/${fileName}`;
        videoFileRows.push({
          tenantId: org.id,
          projectName: project.name,
          runId: Number(run.id),
          logGroup: 'video',
          logName,
          time: new Date(baseTime + step * 1000).toISOString().replace('T', ' ').replace('Z', ''),
          step,
          fileName,
          fileType: 'video/mp4',
          fileSize: mp4.length,
          ...(caption !== null ? { caption } : {}),
        });
        mediaS3Uploads.push(
          mediaS3.send(new PutObjectCommand({
            Bucket: mediaStorageBucket,
            Key: s3Key,
            Body: mp4,
            ContentType: 'video/mp4',
          })),
        );
      };

      for (const run of mediaRuns) {
        for (const logName of ['video/animation', 'video/reconstruction']) {
          for (const step of videoSteps) {
            pushVideoFile(run, logName, step, `step_${String(step).padStart(3, '0')}.mp4`, null);
          }
        }

        // Captioned, multi-sample video: two samples per step, each with a
        // distinct user-supplied caption. The 2 samples/step force the
        // single-run 2-up grid layout (where the caption clipping regressed),
        // and the captions verify caption-over-filename rendering.
        for (const step of videoSteps) {
          for (const sample of [0, 1]) {
            const fileName = `pair_${sample}_step_${String(step).padStart(3, '0')}.mp4`;
            const caption = `prompt: captioned_pair sample ${sample} | step ${step}`;
            pushVideoFile(run, 'video/captioned_pair', step, fileName, caption);
          }
        }
      }

      if (videoFileRows.length > 0) {
        await mediaCh.insert({ table: 'mlop_files', values: videoFileRows, format: 'JSONEachRow' });
        console.log(`   ✓ Inserted ${videoFileRows.length} video file rows into ClickHouse`);
      }

      // --- Console logs (mlop_logs) ---
      // sys.stderr and sys.stdout are virtual entries read from mlop_logs (not RunLogs).
      // Seed error + info log lines so dashboard console widgets have data.
      const consoleLogRows: Record<string, unknown>[] = [];
      const errorMessages = [
        'CUDA out of memory. Tried to allocate 512MB. GPU 0 has 128MB free',
        'NaN detected in gradients at step {step}. Skipping batch.',
        'WARNING: Loss spike detected. Reducing loss scale.',
        'Gradient overflow detected in layer 2. Clipping applied.',
        'Numerical instability in attention scores. Applying clipping.',
      ];
      const infoMessages = [
        '[Epoch {epoch}/30] train_loss=0.4523 val_loss=0.5012 acc=0.812',
        '  LR: 0.000300 | Grad norm: 0.845 | Batch time: 125.3ms',
        '  GPU mem: 24.5GB | Util: 87% | Throughput: 12500 samples/s',
        'Saving checkpoint at epoch {epoch}...',
        'Checkpoint saved successfully',
        'Evaluation complete: accuracy=0.8234 f1=0.7891',
      ];

      for (const run of mediaRuns) {
        const baseTime = run.createdAt.getTime();
        let lineNum = 0;

        // stderr lines (logType = 'error')
        for (let i = 0; i < 20; i++) {
          const msg = errorMessages[i % errorMessages.length]
            .replace('{step}', String(i * 50))
            .replace('{epoch}', String(i));
          consoleLogRows.push({
            tenantId: org.id,
            projectName: project.name,
            runId: Number(run.id),
            logType: 'error',
            time: new Date(baseTime + i * 2000).toISOString().replace('T', ' ').replace('Z', ''),
            lineNumber: lineNum++,
            message: msg,
            step: i,
          });
        }

        // stdout lines (logType = 'info')
        for (let i = 0; i < 30; i++) {
          const msg = infoMessages[i % infoMessages.length]
            .replace('{epoch}', String(i));
          consoleLogRows.push({
            tenantId: org.id,
            projectName: project.name,
            runId: Number(run.id),
            logType: 'info',
            time: new Date(baseTime + i * 1000).toISOString().replace('T', ' ').replace('Z', ''),
            lineNumber: lineNum++,
            message: msg,
            step: i,
          });
        }
      }

      if (consoleLogRows.length > 0) {
        await mediaCh.insert({ table: 'mlop_logs', values: consoleLogRows, format: 'JSONEachRow' });
        console.log(`   ✓ Inserted ${consoleLogRows.length} console log rows into ClickHouse`);
      }

      // Upload all media files to S3
      await Promise.all(mediaS3Uploads);
      console.log(`   ✓ Uploaded ${mediaS3Uploads.length} media files to S3/MinIO`);

      await mediaCh.close();
    } else {
      console.log('   ⚠ No a-bulk-run-011..013 found for media seeding');
    }
  } else {
    console.log('   ⚠ Missing CLICKHOUSE_URL or STORAGE_* env vars, skipping media-rich seeding');
  }

  // All raw mlop_metrics inserts above propagate synchronously to
  // mlop_metrics_v2 via the mirror MV. Trigger the refreshable summaries MV
  // once now so mlop_metric_summaries_v2 is populated for any test that
  // reads it. Replaces 6 piecemeal INSERT INTO mlop_metric_summaries blocks
  // scattered through the seeders.
  if (process.env.CLICKHOUSE_URL) {
    console.log('\n📊 Refreshing mlop_metric_summaries_v2...');
    const refreshCh = createClient({
      url: process.env.CLICKHOUSE_URL,
      username: process.env.CLICKHOUSE_USER || 'default',
      password: process.env.CLICKHOUSE_PASSWORD || '',
    });
    await refreshMetricSummariesAndWait(refreshCh);
    await refreshCh.close();
    console.log('   ✓ mlop_metric_summaries_v2 refreshed');
  }

  const testData: TestData = {
    userId: user.id,
    organizationId: org.id,
    organizationSlug: org.slug,
    organization2Id: org2.id,
    organization2Slug: org2.slug,
    apiKey: fullApiKey,
    apiKeyId: apiKey.id,
    projectName: project.name,
    projectId: String(project.id),
  };

  console.log('\n✅ Test database setup complete!\n');
  console.log('📋 Test Data:');
  console.log('─────────────────────────────────────────────────');
  console.log(`User ID:          ${testData.userId}`);
  console.log(`Organization:     ${testData.organizationSlug}`);
  console.log(`Organization ID:  ${testData.organizationId}`);
  console.log(`Project:          ${testData.projectName}`);
  console.log(`API Key:          ${testData.apiKey}`);
  console.log('─────────────────────────────────────────────────\n');

  // Output in CI-compatible format (no quotes, no export prefix)
  console.log('# Environment variables for CI:');
  console.log(`TEST_API_KEY=${testData.apiKey}`);
  console.log(`TEST_ORG_SLUG=${testData.organizationSlug}`);
  console.log(`TEST_PROJECT_NAME=${testData.projectName}`);
  console.log(`TEST_USER_EMAIL=${testEmail}`);

  // Append test-specific variables to .env.test file
  const envContent = `
# Auto-generated test environment variables
TEST_API_KEY="${testData.apiKey}"
TEST_ORG_SLUG="${testData.organizationSlug}"
TEST_PROJECT_NAME="${testData.projectName}"
TEST_USER_EMAIL="${testEmail}"
TEST_BASE_URL="http://localhost:3001"
TEST_PY_URL="http://localhost:3004"
`;

  const fs = await import('fs/promises');
  await fs.appendFile('.env.test', envContent);
  console.log('📝 Appended test variables to .env.test\n');

  return testData;
}

async function cleanupTestData() {
  console.log('🧹 Cleaning up test data...\n');

  const orgSlugs = ['smoke-test-org', 'smoke-test-org-2'];

  // First, collect all org IDs and delete ALL runs (to avoid FK constraint on apiKey)
  const orgIds: string[] = [];
  for (const orgSlug of orgSlugs) {
    const org = await prisma.organization.findUnique({
      where: { slug: orgSlug },
    });
    if (org) {
      orgIds.push(org.id);
    }
  }

  // Delete all runs first (they reference apiKeys via creatorApiKeyId)
  if (orgIds.length > 0) {
    await prisma.runs.deleteMany({ where: { organizationId: { in: orgIds } } });
    console.log('   ✓ Deleted all test runs');
  }

  // Now delete the rest for each org
  for (const orgSlug of orgSlugs) {
    const org = await prisma.organization.findUnique({
      where: { slug: orgSlug },
    });

    if (org) {
      // Delete in correct order to respect foreign key constraints
      await prisma.apiKey.deleteMany({ where: { organizationId: org.id } });
      await prisma.projects.deleteMany({ where: { organizationId: org.id } });
      await prisma.organizationSubscription.deleteMany({ where: { organizationId: org.id } });
      await prisma.member.deleteMany({ where: { organizationId: org.id } });
      await prisma.organization.delete({ where: { id: org.id } });
      console.log(`   ✓ Deleted test organization ${orgSlug} and related data`);
    }
  }

  const testEmail = 'test-smoke@mlop.local';
  const user = await prisma.user.findUnique({
    where: { email: testEmail },
  });

  if (user) {
    await prisma.user.delete({ where: { id: user.id } });
    console.log('   ✓ Deleted test user');
  }

  console.log('\n✅ Cleanup complete!\n');
}

// Main execution
const command = process.argv[2];

if (command === 'cleanup') {
  cleanupTestData()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error('❌ Error during cleanup:', error);
      process.exit(1);
    })
    .finally(() => prisma.$disconnect());
} else {
  setupTestData()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error('❌ Error during setup:', error);
      process.exit(1);
    })
    .finally(() => prisma.$disconnect());
}
