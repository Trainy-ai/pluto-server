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
const METRICS_PER_RUN = 10;
const DATAPOINTS_PER_METRIC = 100;

/**
 * Seeds ClickHouse with metric datapoints.
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

  const totalRows = runs.length * METRICS_PER_RUN * DATAPOINTS_PER_METRIC;
  console.log(`   Seeding ClickHouse with ${totalRows.toLocaleString()} metric datapoints...`);

  const BATCH_SIZE = 10000;
  let batch: Record<string, unknown>[] = [];
  let insertedCount = 0;
  const baseTime = Date.now() - DATAPOINTS_PER_METRIC * 1000;

  for (const run of runs) {
    for (let m = 0; m < METRICS_PER_RUN; m++) {
      const metricName = `train/${['loss', 'accuracy', 'lr', 'grad_norm', 'epoch_time'][m % 5]}_${Math.floor(m / 5)}`;

      for (let step = 0; step < DATAPOINTS_PER_METRIC; step++) {
        batch.push({
          tenantId,
          projectName,
          runId: Number(run.id),
          logGroup: 'train',
          logName: metricName,
          time: new Date(baseTime + step * 1000).toISOString().replace('T', ' ').replace('Z', ''),
          step,
          // Realistic metric values
          value: m % 5 === 0
            ? Math.exp(-step / 30) * 2 + Math.random() * 0.1 // loss - decaying
            : m % 5 === 1
              ? 0.5 + (step / DATAPOINTS_PER_METRIC) * 0.45 + Math.random() * 0.02 // accuracy - increasing
              : Math.random() * 0.01 + 0.001, // other metrics
        });

        if (batch.length >= BATCH_SIZE) {
          await clickhouse.insert({
            table: 'mlop_metrics',
            values: batch,
            format: 'JSONEachRow',
          });
          insertedCount += batch.length;
          batch = [];
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
  console.log(`   Seeded ${insertedCount.toLocaleString()} metric datapoints`);
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
    Array.from({ length: METRICS_PER_RUN }, (_, i) => ({
      runId: run.id,
      logName: `train/${['loss', 'accuracy', 'lr', 'grad_norm', 'epoch_time'][i % 5]}_${Math.floor(i / 5)}`,
      logGroup: 'train',
      logType: 'METRIC' as const,
    }))
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
