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
  const STEPS = 3000;
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
      name: `bulk-run-${String(i).padStart(3, '0')}`,
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
      config: { epochs: 50, lr: 0.01 },
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
      config: { epochs: 100, lr: 0.001 },
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
        name: { startsWith: 'bulk-run-' },
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

  // 12. Seed image and file data for file-viewer and step-sync E2E tests
  console.log('\n1️⃣2️⃣ Seeding image and file data...');

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
