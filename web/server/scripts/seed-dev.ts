/**
 * Seed development data for local Docker Compose environment.
 * Creates a demo user with pre-populated runs and metrics.
 *
 * Usage:
 *   pnpm seed:dev        - Seed using .env.local
 *   pnpm seed:dev:docker - Seed using .env (Docker Compose)
 */

import { PrismaClient } from '@prisma/client';
import { scryptAsync } from '@noble/hashes/scrypt.js';
import { createClient } from '@clickhouse/client-web';
import crypto from 'crypto';
import { nanoid } from 'nanoid';

const prisma = new PrismaClient();

const DEV_USER = {
  email: 'dev@example.com',
  password: 'devpassword123',
  name: 'Dev User',
};

const DEV_ORG = {
  name: 'Development Org',
  slug: 'dev-org',
};

const DEV_PROJECT = 'my-ml-project';

// Seeding configuration - need 160+ runs to test pagination (frontend loads 150 at a time)
const RUNS_COUNT = 170;
const METRICS_PER_RUN = 50; // 50 charts per run (tests lazy loading)

// High-fidelity subset: first 5 runs get 100k datapoints (realistic training runs)
// Remaining runs get 1k datapoints (sufficient for pagination testing)
const HIGH_FIDELITY_RUNS = 5;
const HIGH_FIDELITY_DATAPOINTS = 100_000; // 100k steps (realistic training run)
const STANDARD_DATAPOINTS = 1_000; // 1k steps (pagination test data)

// Metric groups and names for realistic variety
const METRIC_GROUPS = ['train', 'eval', 'system', 'custom', 'test'];
const METRIC_NAMES = [
  'loss', 'accuracy', 'lr', 'grad_norm', 'epoch_time',
  'precision', 'recall', 'f1', 'auc', 'perplexity',
  'gpu_util', 'memory_used', 'throughput', 'latency',
];

// Test metrics: parallel horizontal and slanted lines for visual debugging
const TEST_METRIC_NAMES = ['horizontal', 'slanted_up', 'slanted_down'];

/**
 * Generates a metric name from group and name arrays.
 * First few metrics are "test" group with parallel lines for visual debugging.
 */
function getMetricName(metricIndex: number): { group: string; name: string; isTestMetric: boolean } {
  // First 3 metrics are test metrics (parallel lines)
  if (metricIndex < TEST_METRIC_NAMES.length) {
    return {
      group: 'test',
      name: `test/${TEST_METRIC_NAMES[metricIndex]}`,
      isTestMetric: true,
    };
  }

  // Rest are normal metrics
  const adjustedIndex = metricIndex - TEST_METRIC_NAMES.length;
  const nonTestGroups = METRIC_GROUPS.filter(g => g !== 'test');
  const groupIndex = Math.floor(adjustedIndex / METRIC_NAMES.length) % nonTestGroups.length;
  const nameIndex = adjustedIndex % METRIC_NAMES.length;
  const suffix = Math.floor(adjustedIndex / (nonTestGroups.length * METRIC_NAMES.length));
  return {
    group: nonTestGroups[groupIndex],
    name: `${nonTestGroups[groupIndex]}/${METRIC_NAMES[nameIndex]}${suffix > 0 ? `_${suffix}` : ''}`,
    isTestMetric: false,
  };
}

/**
 * Generates a realistic metric value based on metric type and step.
 * For test metrics, generates parallel lines at different y-intercepts for each run.
 */
function getMetricValue(metricIndex: number, step: number, totalSteps: number, runIndex: number = 0): number {
  // Test metrics: parallel lines for visual debugging
  if (metricIndex < TEST_METRIC_NAMES.length) {
    const testMetricName = TEST_METRIC_NAMES[metricIndex];
    const progress = step / totalSteps;
    // Each run gets a different y-intercept (spacing of 0.1)
    const yIntercept = runIndex * 0.1;

    switch (testMetricName) {
      case 'horizontal':
        // Perfectly horizontal lines at different y levels
        return yIntercept + 0.5;
      case 'slanted_up':
        // Parallel slanted lines going up
        return yIntercept + progress * 0.5;
      case 'slanted_down':
        // Parallel slanted lines going down
        return yIntercept + 1 - progress * 0.5;
      default:
        return yIntercept;
    }
  }

  // Normal metrics
  const adjustedIndex = metricIndex - TEST_METRIC_NAMES.length;
  const nameIndex = adjustedIndex % METRIC_NAMES.length;
  const metricName = METRIC_NAMES[nameIndex];
  const progress = step / totalSteps;

  switch (metricName) {
    case 'loss':
      return Math.exp(-step / (totalSteps / 3)) * 2 + Math.random() * 0.1;
    case 'accuracy':
    case 'precision':
    case 'recall':
    case 'f1':
    case 'auc':
      return 0.5 + progress * 0.45 + Math.random() * 0.02;
    case 'perplexity':
      return 100 * Math.exp(-step / (totalSteps / 2)) + 10 + Math.random() * 5;
    case 'lr':
      // Warmup then decay
      return step < totalSteps * 0.1
        ? 0.001 * (step / (totalSteps * 0.1))
        : 0.001 * Math.exp(-(step - totalSteps * 0.1) / totalSteps);
    case 'gpu_util':
      return 80 + Math.random() * 15;
    case 'memory_used':
      return 0.7 + Math.random() * 0.2;
    case 'throughput':
      return 1000 + Math.random() * 200;
    case 'latency':
      return 10 + Math.random() * 5;
    default:
      return Math.random() * 0.01 + 0.001;
  }
}

/**
 * Seeds ClickHouse with metric datapoints.
 * Uses high-fidelity subset: first 5 runs get 100k datapoints, rest get 1k.
 */
async function seedClickHouseMetrics(
  runs: { id: bigint; name: string }[],
  tenantId: string,
  projectName: string,
): Promise<void> {
  const clickhouseUrl = process.env.CLICKHOUSE_URL;
  const clickhouseUser = process.env.CLICKHOUSE_USER || 'default';
  const clickhousePassword = process.env.CLICKHOUSE_PASSWORD || '';

  if (!clickhouseUrl) {
    console.log('   CLICKHOUSE_URL not set, skipping ClickHouse seeding');
    return;
  }

  const clickhouse = createClient({
    url: clickhouseUrl,
    username: clickhouseUser,
    password: clickhousePassword,
  });

  // Calculate total rows with high-fidelity subset
  const highFidelityRows = Math.min(HIGH_FIDELITY_RUNS, runs.length) * METRICS_PER_RUN * HIGH_FIDELITY_DATAPOINTS;
  const standardRows = Math.max(0, runs.length - HIGH_FIDELITY_RUNS) * METRICS_PER_RUN * STANDARD_DATAPOINTS;
  const totalRows = highFidelityRows + standardRows;

  console.log(`   Seeding ClickHouse with ${totalRows.toLocaleString()} metric datapoints...`);
  console.log(`   - ${Math.min(HIGH_FIDELITY_RUNS, runs.length)} high-fidelity runs × ${METRICS_PER_RUN} metrics × ${HIGH_FIDELITY_DATAPOINTS.toLocaleString()} points`);
  console.log(`   - ${Math.max(0, runs.length - HIGH_FIDELITY_RUNS)} standard runs × ${METRICS_PER_RUN} metrics × ${STANDARD_DATAPOINTS.toLocaleString()} points`);

  const BATCH_SIZE = 50000; // Larger batch for faster inserts
  let batch: Record<string, unknown>[] = [];
  let insertedCount = 0;
  const startTime = Date.now();

  for (let runIndex = 0; runIndex < runs.length; runIndex++) {
    const run = runs[runIndex];
    const datapointsForRun = runIndex < HIGH_FIDELITY_RUNS ? HIGH_FIDELITY_DATAPOINTS : STANDARD_DATAPOINTS;
    const baseTime = Date.now() - datapointsForRun * 1000;

    for (let m = 0; m < METRICS_PER_RUN; m++) {
      const { group, name } = getMetricName(m);

      for (let step = 0; step < datapointsForRun; step++) {
        batch.push({
          tenantId,
          projectName,
          runId: Number(run.id),
          logGroup: group,
          logName: name,
          time: new Date(baseTime + step * 1000).toISOString().replace('T', ' ').replace('Z', ''),
          step,
          value: getMetricValue(m, step, datapointsForRun, runIndex),
        });

        if (batch.length >= BATCH_SIZE) {
          await clickhouse.insert({
            table: 'mlop_metrics',
            values: batch,
            format: 'JSONEachRow',
          });
          insertedCount += batch.length;
          batch = [];

          // Progress logging
          const elapsed = (Date.now() - startTime) / 1000;
          const rate = insertedCount / elapsed;
          const remaining = (totalRows - insertedCount) / rate;
          console.log(`   Progress: ${insertedCount.toLocaleString()}/${totalRows.toLocaleString()} (${Math.round(rate).toLocaleString()} rows/sec, ~${Math.round(remaining)}s remaining)`);
        }
      }
    }
  }

  if (batch.length > 0) {
    await clickhouse.insert({
      table: 'mlop_metrics',
      values: batch,
      format: 'JSONEachRow',
    });
    insertedCount += batch.length;
  }

  await clickhouse.close();
  const totalTime = (Date.now() - startTime) / 1000;
  console.log(`   Seeded ${insertedCount.toLocaleString()} metric datapoints in ${totalTime.toFixed(1)}s`);
}

async function main() {
  console.log('Seeding development data...\n');

  // 1. Create dev user with password auth
  console.log('1. Creating dev user...');
  let user = await prisma.user.findUnique({ where: { email: DEV_USER.email } });

  if (!user) {
    user = await prisma.user.create({
      data: {
        id: nanoid(),
        email: DEV_USER.email,
        name: DEV_USER.name,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        finishedOnboarding: true,
      },
    });

    // Create password auth using better-auth's scrypt format
    const salt = crypto.randomBytes(16).toString('hex');
    const key = await scryptAsync(DEV_USER.password.normalize('NFKC'), salt, {
      N: 16384,
      r: 16,
      p: 1,
      dkLen: 64,
      maxmem: 128 * 16384 * 16 * 2,
    });
    const hashedPassword = `${salt}:${Buffer.from(key).toString('hex')}`;

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

    console.log(`   Created user: ${DEV_USER.email}`);
  } else {
    console.log(`   User exists: ${DEV_USER.email}`);
  }

  // 2. Create organization
  console.log('\n2. Creating organization...');
  let org = await prisma.organization.findUnique({ where: { slug: DEV_ORG.slug } });

  if (!org) {
    org = await prisma.organization.create({
      data: {
        id: nanoid(),
        name: DEV_ORG.name,
        slug: DEV_ORG.slug,
        createdAt: new Date(),
        members: {
          create: {
            id: nanoid(),
            userId: user.id,
            role: 'OWNER',
            createdAt: new Date(),
          },
        },
      },
    });
    console.log(`   Created org: ${DEV_ORG.slug}`);
  } else {
    console.log(`   Org exists: ${DEV_ORG.slug}`);

    // Ensure user is a member
    const membership = await prisma.member.findFirst({
      where: { userId: user.id, organizationId: org.id },
    });

    if (!membership) {
      await prisma.member.create({
        data: {
          id: nanoid(),
          userId: user.id,
          organizationId: org.id,
          role: 'OWNER',
          createdAt: new Date(),
        },
      });
    }
  }

  // Ensure organization has a subscription
  const subscription = await prisma.organizationSubscription.findUnique({
    where: { organizationId: org.id },
  });

  if (!subscription) {
    await prisma.organizationSubscription.create({
      data: {
        organizationId: org.id,
        stripeCustomerId: `cus_dev_${org.id.substring(0, 8)}`,
        stripeSubscriptionId: `sub_dev_${org.id.substring(0, 8)}`,
        plan: 'PRO',
        seats: 10,
        usageLimits: {
          dataUsageGB: 100,
          trainingHoursPerMonth: 750,
        },
      },
    });
    console.log(`   Created subscription`);
  }

  // 3. Create API key
  console.log('\n3. Creating API key...');
  let apiKey = await prisma.apiKey.findFirst({
    where: { organizationId: org.id, name: 'Dev API Key' },
  });

  const apiKeyValue = `mlps_dev_${nanoid(32)}`;

  if (!apiKey) {
    apiKey = await prisma.apiKey.create({
      data: {
        id: nanoid(),
        key: apiKeyValue, // Store plaintext in dev for convenience
        keyString: apiKeyValue.slice(0, 15) + '...',
        name: 'Dev API Key',
        organizationId: org.id,
        userId: user.id,
        isHashed: false,
        createdAt: new Date(),
      },
    });
    console.log(`   Created API key: ${apiKeyValue}`);
  } else {
    // Update with new key
    await prisma.apiKey.update({
      where: { id: apiKey.id },
      data: { key: apiKeyValue, isHashed: false },
    });
    console.log(`   Updated API key: ${apiKeyValue}`);
  }

  // 4. Create project
  console.log('\n4. Creating project...');
  let project = await prisma.projects.findUnique({
    where: {
      organizationId_name: {
        organizationId: org.id,
        name: DEV_PROJECT,
      },
    },
  });

  if (!project) {
    project = await prisma.projects.create({
      data: {
        name: DEV_PROJECT,
        organizationId: org.id,
      },
    });
    console.log(`   Created project: ${DEV_PROJECT}`);
  } else {
    console.log(`   Project exists: ${DEV_PROJECT}`);
  }

  // 5. Create runs with metrics
  console.log(`\n5. Creating ${RUNS_COUNT} runs with metrics...`);

  // Check how many runs already exist
  const existingRunCount = await prisma.runs.count({
    where: { projectId: project.id, organizationId: org.id },
  });

  const runsToCreate = RUNS_COUNT - existingRunCount;

  if (runsToCreate > 0) {
    // Named runs - hidden-needle at index 10 will be "old" (won't appear in first 150 results)
    const runNames = [
      'baseline-experiment',
      'transformer-v1',
      'cnn-resnet50',
      'lr-search-001',
      'batch-size-test',
      'adam-vs-sgd',
      'data-augmentation',
      'dropout-study',
      'weight-decay-exp',
      'warmup-schedule',
      'hidden-needle-experiment', // Index 10 - OLD run for search testing (won't be in first 150)
    ];

    // Unique tag per run for stress testing (170 unique tags)
    // hidden-needle-experiment (index 10) also gets 'needle-tag' for tag filter testing
    const NEEDLE_TAG = 'needle-tag';

    // Base date: 170 hours ago. Each run is 1 hour newer than the previous.
    // Index 0 = oldest (170 hours ago), Index 169 = newest (now)
    // This means runs at index 0-19 are "old" and won't appear in first 150 results (sorted by newest)
    const baseDate = new Date(Date.now() - RUNS_COUNT * 60 * 60 * 1000);

    const runData = Array.from({ length: runsToCreate }, (_, idx) => {
      const i = existingRunCount + idx; // Continue numbering from existing
      const createdAt = new Date(baseDate.getTime() + i * 60 * 60 * 1000); // 1 hour per run
      // Each run gets a unique tag, hidden-needle-experiment also gets needle-tag
      const uniqueTag = `run-tag-${String(i).padStart(3, '0')}`;
      const tags = i === 10 ? [uniqueTag, NEEDLE_TAG] : [uniqueTag]; // Index 10 = hidden-needle-experiment
      return {
        name: i < runNames.length ? runNames[i] : `experiment-${String(i).padStart(3, '0')}`,
        organizationId: org.id,
        projectId: project.id,
        createdById: user.id,
        creatorApiKeyId: apiKey.id,
        status: i % 5 === 0 ? ('RUNNING' as const) : ('COMPLETED' as const),
        tags,
        config: {
          model: ['resnet50', 'transformer', 'bert', 'gpt2'][i % 4],
          lr: 0.001 * (i + 1),
          batch_size: [16, 32, 64, 128][i % 4],
          epochs: 100,
        },
        systemMetadata: {
          hostname: `dev-machine-${i % 3}`,
          gpu: ['A100', 'V100', 'RTX 4090'][i % 3],
          python: '3.11',
        },
        createdAt,
        updatedAt: createdAt,
      };
    });

    // Create runs first (Prisma's @default(now()) will set identical timestamps)
    const createResult = await prisma.runs.createMany({
      data: runData.map(({ createdAt, updatedAt, ...rest }) => rest),
      skipDuplicates: true,
    });
    console.log(`   Bulk created ${createResult.count} runs`);

    // Then update each run's createdAt with raw SQL to set chronological dates
    const allCreatedRuns = await prisma.runs.findMany({
      where: { projectId: project.id, organizationId: org.id },
      orderBy: { id: 'asc' },
      select: { id: true },
    });

    console.log(`   Updating ${allCreatedRuns.length} runs with chronological dates...`);
    for (let i = 0; i < allCreatedRuns.length; i++) {
      const createdAt = new Date(baseDate.getTime() + i * 60 * 60 * 1000);
      await prisma.$executeRaw`UPDATE "runs" SET "createdAt" = ${createdAt}, "updatedAt" = ${createdAt} WHERE id = ${allCreatedRuns[i].id}`;
      if ((i + 1) % 50 === 0) {
        console.log(`   Updated ${i + 1}/${allCreatedRuns.length} dates...`);
      }
    }
    console.log(`   Created ${runsToCreate} new runs (total: ${RUNS_COUNT})`);
  } else {
    console.log(`   ${existingRunCount} runs already exist (target: ${RUNS_COUNT})`);
  }

  // Fetch ALL runs to ensure metrics are seeded
  const allRuns = await prisma.runs.findMany({
    where: {
      projectId: project.id,
      organizationId: org.id,
    },
    select: { id: true, name: true },
  });

  // Register metric names (skipDuplicates handles existing ones)
  const runLogData = allRuns.flatMap((run) =>
    Array.from({ length: METRICS_PER_RUN }, (_, i) => {
      const { group, name } = getMetricName(i);
      return {
        runId: run.id,
        logName: name,
        logGroup: group,
        logType: 'METRIC' as const,
      };
    })
  );

  await prisma.runLogs.createMany({
    data: runLogData,
    skipDuplicates: true,
  });
  console.log(`   Ensured ${allRuns.length * METRICS_PER_RUN} metric names registered`);

  // Always seed ClickHouse (check if metrics exist first)
  await seedClickHouseMetrics(allRuns, org.id, project.name);

  console.log('\n' + '='.repeat(50));
  console.log('Development data seeded successfully!\n');
  console.log('Login credentials:');
  console.log(`   Email:    ${DEV_USER.email}`);
  console.log(`   Password: ${DEV_USER.password}`);
  console.log(`   Org URL:  http://localhost:3000/o/${DEV_ORG.slug}`);
  console.log(`   API Key:  ${apiKeyValue}`);
  console.log('='.repeat(50) + '\n');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Error during seeding:', error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
