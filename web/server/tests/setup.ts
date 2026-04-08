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
import { createClient } from '@clickhouse/client-web';
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
 * Seeds ClickHouse with metric datapoints for bulk test runs.
 * Creates realistic training metrics (loss curves with exponential decay).
 */
async function seedClickHouseMetrics(
  runs: { id: bigint; name: string; createdAt: Date }[],
  tenantId: string,
  projectName: string,
  metricsPerRun: number,
  datapointsPerMetric: number,
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
      const metricName = `train/metric_${String(m).padStart(2, '0')}`;

      for (let step = 0; step < datapointsPerMetric; step++) {
        batch.push({
          tenantId,
          projectName,
          runId: Number(run.id),
          logGroup: 'train',
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

  // Populate mlop_metric_summaries directly (the MV may not exist if SQL
  // files were executed in alphabetical order where metric_summaries_mv.sql
  // runs before metrics.sql, causing the MV creation to fail).
  try {
    await clickhouse.query({
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
          sum(value * value)       AS sum_sq_value
        FROM mlop_metrics
        WHERE tenantId = {tenantId: String}
          AND projectName = {projectName: String}
          AND isFinite(value)
        GROUP BY tenantId, projectName, runId, logName
      `,
      query_params: { tenantId, projectName },
    });
    console.log('   ✓ Populated mlop_metric_summaries from mlop_metrics');
  } catch (err) {
    console.log('   ⚠ Could not populate mlop_metric_summaries:', (err as Error).message);
  }

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
        seats: 10,
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

  // 4. Create or get test projects (multiple for pagination tests)
  console.log('\n4️⃣  Creating test projects...');
  const projectNames = ['smoke-test-project', 'test-project-2', 'test-project-3'];
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

      // Populate metric summaries for the staircase run
      try {
        await clickhouse.query({
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
              sum(value * value)       AS sum_sq_value
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
            runId: Number(staircaseRun.id),
          },
        });
        console.log('   ✓ Populated metric summaries for staircase run');
      } catch (err) {
        console.log('   ⚠ Could not populate staircase metric summaries:', (err as Error).message);
      }

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

  // 5d-dedup. Create dedup-test run for step deduplication tests
  console.log('\n5️⃣d-dedup Creating dedup-test run...');

  let dedupRun = await prisma.runs.findFirst({
    where: { organizationId: org.id, projectId: project.id, name: 'dedup-test' },
  });

  if (!dedupRun) {
    const dedupCreatedAt = new Date(Date.now() - 364 * 24 * 60 * 60 * 1000);
    dedupRun = await prisma.runs.create({
      data: {
        name: 'dedup-test',
        organizationId: org.id,
        projectId: project.id,
        createdById: user.id,
        creatorApiKeyId: apiKey.id,
        status: 'COMPLETED',
        createdAt: dedupCreatedAt,
        updatedAt: dedupCreatedAt,
      },
    });
    console.log(`   ✓ Created dedup-test run (ID: ${dedupRun.id})`);

    // Register metric in run_logs
    await prisma.runLogs.createMany({
      data: [
        { runId: dedupRun.id, logName: 'test/dedup_metric', logGroup: 'test', logType: 'METRIC' },
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

      // Seed 200 steps with 2 values each:
      //   Value 1 (wrong, logged first):  step * 10  (huge)
      //   Value 2 (correct, logged second): step      (true curve)
      // Timestamps differ by 1 second so argMax(value, time) picks the correct one.
      const DEDUP_STEPS = 200;
      const baseTime = dedupRun.createdAt.getTime();
      const dedupRows: Record<string, unknown>[] = [];

      for (let step = 0; step < DEDUP_STEPS; step++) {
        // Wrong value — earlier timestamp
        dedupRows.push({
          tenantId: org.id,
          projectName: project.name,
          runId: Number(dedupRun.id),
          logGroup: 'test',
          logName: 'test/dedup_metric',
          time: new Date(baseTime + step * 2000).toISOString().replace('T', ' ').replace('Z', ''),
          step,
          value: step * 10, // 10x the correct value
        });
        // Correct value — later timestamp (1 second later)
        dedupRows.push({
          tenantId: org.id,
          projectName: project.name,
          runId: Number(dedupRun.id),
          logGroup: 'test',
          logName: 'test/dedup_metric',
          time: new Date(baseTime + step * 2000 + 1000).toISOString().replace('T', ' ').replace('Z', ''),
          step,
          value: step, // true value
        });
      }

      await clickhouse.insert({
        table: 'mlop_metrics',
        values: dedupRows,
        format: 'JSONEachRow',
      });
      console.log(`   ✓ Seeded ${DEDUP_STEPS * 2} dedup metric datapoints (${DEDUP_STEPS} steps × 2 duplicates)`);

      await clickhouse.close();
    } else {
      console.log('   ⚠ CLICKHOUSE_URL not set, skipping dedup ClickHouse seeding');
    }
  } else {
    console.log(`   ✓ dedup-test run already exists (ID: ${dedupRun.id})`);
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

      // Populate metric summaries for the multi-metric run
      try {
        await clickhouse.query({
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
              sum(value * value)       AS sum_sq_value
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
            runId: Number(multiMetricRun.id),
          },
        });
        console.log('   ✓ Populated metric summaries for multi-metric run');
      } catch (err) {
        console.log('   ⚠ Could not populate multi-metric metric summaries:', (err as Error).message);
      }

      await clickhouse.close();
    } else {
      console.log('   ⚠ CLICKHOUSE_URL not set, skipping multi-metric ClickHouse seeding');
    }
  } else {
    console.log(`   ✓ multi-metric-test run already exists (ID: ${multiMetricRun.id})`);
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

      // Populate metric summaries
      for (const run of [shortRun, longRun]) {
        try {
          await clickhouse.query({
            query: `
              INSERT INTO mlop_metric_summaries
              SELECT
                tenantId, projectName, runId, logName,
                min(value), max(value), sum(value),
                toUInt64(count()), argMaxState(value, step), sum(value * value)
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
        } catch (err) {
          console.log(`   ⚠ Could not populate summaries for ${run.name}:`, (err as Error).message);
        }
      }

      await clickhouse.close();
    }

    console.log(`   ✓ Created zoom-visibility-short (ID: ${shortRun.id}) and zoom-visibility-long (ID: ${longRun.id})`);
  } else {
    console.log('   ✓ zoom-visibility runs already exist');
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

  // 11d. Create "Dedup Test" dashboard view for step deduplication E2E tests
  console.log('\n1️⃣1️⃣d Creating Dedup Test dashboard view...');

  const dedupDashboardConfig = {
    version: 1,
    sections: [
      {
        id: 'dedup-static-section',
        name: 'Dedup Metrics (Static)',
        collapsed: false,
        widgets: [
          {
            id: 'dedup-static-widget',
            type: 'chart',
            config: {
              title: 'Dedup metric',
              metrics: ['test/dedup_metric'],
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
      {
        id: 'dedup-dynamic-section',
        name: 'Dedup Metrics (Dynamic)',
        collapsed: false,
        widgets: [],
        dynamicPattern: 'test/dedup*',
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
        name: 'Dedup Test',
      },
    },
    update: { config: dedupDashboardConfig },
    create: {
      name: 'Dedup Test',
      organizationId: org.id,
      projectId: project.id,
      createdById: user.id,
      isDefault: false,
      config: dedupDashboardConfig,
    },
  });
  console.log('   ✓ Created Dedup Test dashboard view');

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
      }

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
      ]);
      await prisma.runLogs.createMany({ data: mediaRunLogData, skipDuplicates: true });
      console.log(`   ✓ Registered 8 media log names for ${mediaRuns.length} runs`);

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

      for (const run of mediaRuns) {
        const baseTime = run.createdAt.getTime();
        const runIdx = parseInt(run.name.replace(/.*bulk-run-/, ''), 10);

        for (const logName of ['video/animation', 'video/reconstruction']) {
          const logGroup = 'video';
          for (const step of videoSteps) {
            const fileName = `step_${String(step).padStart(3, '0')}.mp4`;
            // Create minimal valid MP4 file (ftyp + mdat boxes)
            // This is a stub — browsers won't play it but the file viewer will display the entry
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
            const mp4 = Buffer.concat([ftyp, mdatContent]);
            const s3Key = `${org.id}/${project.name}/${run.id}/${logName}/${fileName}`;

            videoFileRows.push({
              tenantId: org.id,
              projectName: project.name,
              runId: Number(run.id),
              logGroup,
              logName,
              time: new Date(baseTime + step * 1000).toISOString().replace('T', ' ').replace('Z', ''),
              step,
              fileName,
              fileType: 'video/mp4',
              fileSize: mp4.length,
            });

            mediaS3Uploads.push(
              mediaS3.send(new PutObjectCommand({
                Bucket: mediaStorageBucket,
                Key: s3Key,
                Body: mp4,
                ContentType: 'video/mp4',
              })),
            );
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
