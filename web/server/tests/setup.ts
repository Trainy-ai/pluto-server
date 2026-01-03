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

const prisma = new PrismaClient();

interface TestData {
  userId: string;
  organizationId: string;
  organizationSlug: string;
  apiKey: string;
  apiKeyId: string;
  projectName: string;
  projectId: string;
}

async function hashApiKey(key: string): Promise<string> {
  return crypto.createHash('sha256').update(key).digest('hex');
}

async function setupTestData(): Promise<TestData> {
  console.log('🔧 Setting up test database...\n');

  // 1. Create or get test user
  console.log('1️⃣  Creating test user...');
  const testEmail = 'test-smoke@mlop.local';

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

  // 2. Create or get test organization
  console.log('\n2️⃣  Creating test organization...');
  const orgSlug = 'smoke-test-org';

  let org = await prisma.organization.findUnique({
    where: { slug: orgSlug },
  });

  if (!org) {
    org = await prisma.organization.create({
      data: {
        id: nanoid(),
        name: 'Smoke Test Organization',
        slug: orgSlug,
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
    console.log(`   ✓ Created organization: ${org.name} (slug: ${org.slug})`);
  } else {
    console.log(`   ✓ Organization already exists: ${org.name} (slug: ${org.slug})`);

    // Ensure user is a member
    const membership = await prisma.member.findUnique({
      where: {
        userId_organizationId: {
          userId: user.id,
          organizationId: org.id,
        },
      },
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
        stripeCustomerId: 'cus_test_smoke_' + org.id.substring(0, 8),
        stripeSubscriptionId: 'sub_test_smoke_' + org.id.substring(0, 8),
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

  // 4. Create or get test project
  console.log('\n4️⃣  Creating test project...');
  const projectName = 'smoke-test-project';

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

  const testData: TestData = {
    userId: user.id,
    organizationId: org.id,
    organizationSlug: org.slug,
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

  const orgSlug = 'smoke-test-org';
  const org = await prisma.organization.findUnique({
    where: { slug: orgSlug },
  });

  if (org) {
    // Delete in correct order to respect foreign key constraints
    await prisma.runs.deleteMany({ where: { organizationId: org.id } });
    await prisma.apiKey.deleteMany({ where: { organizationId: org.id } });
    await prisma.projects.deleteMany({ where: { organizationId: org.id } });
    await prisma.organizationSubscription.deleteMany({ where: { organizationId: org.id } });
    await prisma.member.deleteMany({ where: { organizationId: org.id } });
    await prisma.organization.delete({ where: { id: org.id } });
    console.log('   ✓ Deleted test organization and related data');
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
