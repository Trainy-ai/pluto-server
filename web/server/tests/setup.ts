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
import { createClient } from '@clickhouse/client-web';

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

/**
 * Seeds ClickHouse with metric datapoints for bulk test runs.
 * Creates realistic training metrics (loss curves with exponential decay).
 */
async function seedClickHouseMetrics(
  runs: { id: bigint; name: string }[],
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
  const baseTime = Date.now() - datapointsPerMetric * 1000;

  for (const run of runs) {
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

  await clickhouse.close();
  console.log(`\r   ✓ Seeded ClickHouse with ${insertedCount.toLocaleString()} metric datapoints`);
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
    const bulkRunData = Array.from({ length: SEARCH_TEST_RUN_COUNT }, (_, i) => ({
      name: `bulk-run-${String(i).padStart(3, '0')}`,
      organizationId: org.id,
      projectId: project.id,
      createdById: user.id,
      creatorApiKeyId: apiKey.id,
      status: 'COMPLETED' as const,
      config: { epochs: 100, lr: 0.001, batch_size: 32 },
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
      select: { id: true, name: true },
    });

    // Also fetch the needle run
    const needleRunCreated = await prisma.runs.findFirst({
      where: {
        projectId: project.id,
        organizationId: org.id,
        name: 'hidden-needle-experiment',
      },
      select: { id: true, name: true },
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

    // Seed ClickHouse with metric datapoints
    await seedClickHouseMetrics(
      createdBulkRuns,
      org.id,
      project.name,
      METRICS_PER_RUN,
      DATAPOINTS_PER_METRIC,
    );
  } else {
    console.log(`   ✓ Bulk runs already exist (found needle run)`);
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

  const testData: TestData = {
    userId: user.id,
    organizationId: org.id,
    organizationSlug: org.slug,
    organization2Id: org2.id,
    organization2Slug: org2.slug,
    apiKey: fullApiKey,
    apiKeyId: apiKey.id,
    projectName: project.name,
    projectId: project.id,
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
