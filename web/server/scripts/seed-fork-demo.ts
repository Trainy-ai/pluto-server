/**
 * Seed fork-demo project with forked runs for testing Neptune-style fork visualization.
 *
 * Creates a project "fork-demo" with:
 *   Root (llm_train-v945): steps 0-1000
 *   ├─ Fork A (lr=0.0001): forked@500, own steps 501-800
 *   │  └─ Fork C (lr=0.00005): forked@700, own steps 701-1000
 *   └─ Fork B (lr=0.0005): forked@300, own steps 301-700
 *   Root2 (llm_train-v816): steps 0-800 (separate experiment)
 *
 * Usage:
 *   DATABASE_URL=... CLICKHOUSE_URL=... npx tsx scripts/seed-fork-demo.ts
 */

import { PrismaClient } from '@prisma/client';
import { createClient } from '@clickhouse/client-web';
import { nanoid } from 'nanoid';

const prisma = new PrismaClient();

const DEV_ORG_SLUG = 'dev-org';
const FORK_PROJECT = 'fork-demo';

async function main() {
  console.log('Seeding fork-demo project...\n');

  // Find dev org and user
  const org = await prisma.organization.findUnique({ where: { slug: DEV_ORG_SLUG } });
  if (!org) {
    console.error('Dev org not found. Run the main seed script first.');
    process.exit(1);
  }

  const member = await prisma.member.findFirst({
    where: { organizationId: org.id, role: 'OWNER' },
  });
  if (!member) {
    console.error('No owner member found.');
    process.exit(1);
  }

  const apiKey = await prisma.apiKey.findFirst({
    where: { organizationId: org.id },
  });
  if (!apiKey) {
    console.error('No API key found. Run the main seed script first.');
    process.exit(1);
  }

  // Create or find fork-demo project
  let project = await prisma.projects.findFirst({
    where: { name: FORK_PROJECT, organizationId: org.id },
  });
  if (!project) {
    project = await prisma.projects.create({
      data: {
        name: FORK_PROJECT,
        organizationId: org.id,
        nextRunNumber: 1,
        runPrefix: 'FRK',
      },
    });
    console.log(`Created project: ${FORK_PROJECT}`);
  } else {
    console.log(`Project exists: ${FORK_PROJECT}`);
  }

  // Check if fork runs already exist
  const existingCount = await prisma.runs.count({
    where: { projectId: project.id, organizationId: org.id },
  });

  if (existingCount > 0) {
    console.log(`Fork runs already exist (${existingCount} runs). Deleting and re-seeding...`);
    await prisma.runLogs.deleteMany({ where: { run: { projectId: project.id } } });
    await prisma.runs.deleteMany({ where: { projectId: project.id } });
  }

  const baseTime = new Date(Date.now() - 24 * 60 * 60 * 1000);

  // Root run: steps 0-1000
  const rootRun = await prisma.runs.create({
    data: {
      name: 'llm_train-v945',
      number: 1,
      organizationId: org.id,
      projectId: project.id,
      createdById: member.userId,
      creatorApiKeyId: apiKey.id,
      status: 'COMPLETED',
      tags: ['baseline'],
      config: { model: 'llama-7b', lr: 0.0003, epochs: 50, optimizer: 'AdamW' },
      createdAt: baseTime,
      updatedAt: baseTime,
    },
  });
  console.log(`Created root run: ${rootRun.name} (id=${rootRun.id})`);

  // Fork A: from root at step 500
  const forkA = await prisma.runs.create({
    data: {
      name: 'llm_train-v945',
      number: 2,
      organizationId: org.id,
      projectId: project.id,
      createdById: member.userId,
      creatorApiKeyId: apiKey.id,
      status: 'COMPLETED',
      tags: ['fork-a'],
      config: { model: 'llama-7b', lr: 0.0001, epochs: 50, optimizer: 'AdamW' },
      forkedFromRunId: rootRun.id,
      forkStep: BigInt(500),
      createdAt: new Date(baseTime.getTime() + 6 * 3600_000),
      updatedAt: new Date(baseTime.getTime() + 6 * 3600_000),
    },
  });
  console.log(`Created fork A: forked@500 from root (id=${forkA.id})`);

  // Fork B: from root at step 300
  const forkB = await prisma.runs.create({
    data: {
      name: 'llm_train-v945',
      number: 3,
      organizationId: org.id,
      projectId: project.id,
      createdById: member.userId,
      creatorApiKeyId: apiKey.id,
      status: 'COMPLETED',
      tags: ['fork-b'],
      config: { model: 'llama-7b', lr: 0.0005, epochs: 50, optimizer: 'SGD' },
      forkedFromRunId: rootRun.id,
      forkStep: BigInt(300),
      createdAt: new Date(baseTime.getTime() + 8 * 3600_000),
      updatedAt: new Date(baseTime.getTime() + 8 * 3600_000),
    },
  });
  console.log(`Created fork B: forked@300 from root (id=${forkB.id})`);

  // Fork C: from Fork A at step 700 (deep chain)
  const forkC = await prisma.runs.create({
    data: {
      name: 'llm_train-v945',
      number: 4,
      organizationId: org.id,
      projectId: project.id,
      createdById: member.userId,
      creatorApiKeyId: apiKey.id,
      status: 'RUNNING',
      tags: ['fork-c', 'deep-chain'],
      config: { model: 'llama-7b', lr: 0.00005, epochs: 100, optimizer: 'AdamW' },
      forkedFromRunId: forkA.id,
      forkStep: BigInt(700),
      createdAt: new Date(baseTime.getTime() + 12 * 3600_000),
      updatedAt: new Date(baseTime.getTime() + 12 * 3600_000),
    },
  });
  console.log(`Created fork C: forked@700 from fork A (id=${forkC.id})`);

  // Separate root run (different experiment)
  const rootRun2 = await prisma.runs.create({
    data: {
      name: 'llm_train-v816',
      number: 5,
      organizationId: org.id,
      projectId: project.id,
      createdById: member.userId,
      creatorApiKeyId: apiKey.id,
      status: 'COMPLETED',
      tags: ['v816'],
      config: { model: 'llama-13b', lr: 0.0002, epochs: 30 },
      createdAt: new Date(baseTime.getTime() + 2 * 3600_000),
      updatedAt: new Date(baseTime.getTime() + 2 * 3600_000),
    },
  });
  console.log(`Created root2: ${rootRun2.name} (id=${rootRun2.id})`);

  // Update project counter
  await prisma.projects.update({
    where: { id: project.id },
    data: { nextRunNumber: 6 },
  });

  // Register metric log entries in PostgreSQL
  const allRuns = [rootRun, forkA, forkB, forkC, rootRun2];
  const metrics = ['eval/metrics/loss', 'eval/metrics/accuracy', 'train/loss'];
  await prisma.runLogs.createMany({
    data: allRuns.flatMap((run) =>
      metrics.map((name) => ({
        runId: run.id,
        logGroup: name.split('/').slice(0, -1).join('/'),
        logName: name,
        logType: 'METRIC' as const,
      })),
    ),
    skipDuplicates: true,
  });
  console.log(`Registered ${allRuns.length * metrics.length} metric log entries`);

  // Seed ClickHouse metrics
  const clickhouseUrl = process.env.CLICKHOUSE_URL;
  if (!clickhouseUrl) {
    console.log('CLICKHOUSE_URL not set, skipping metric data seeding');
    return;
  }

  const ch = createClient({
    url: clickhouseUrl,
    username: process.env.CLICKHOUSE_USER || 'default',
    password: process.env.CLICKHOUSE_PASSWORD || '',
  });

  // Clear old fork-demo metrics
  await ch.command({
    query: `ALTER TABLE mlop_metrics DELETE WHERE tenantId = '${org.id}' AND projectName = '${FORK_PROJECT}'`,
  });
  await new Promise(resolve => setTimeout(resolve, 1000));

  const rows: Record<string, unknown>[] = [];

  // Decaying loss curve with noise.
  // The `rate` param controls how fast the curve decays (higher = faster drop).
  // At step 1000 with rate=3.5: exp(-3.5) ≈ 0.03, so loss ≈ 12*0.03 + 0.3 ≈ 0.66
  const lossValue = (step: number, rate: number, seed: number) => {
    const decay = Math.exp(-(step / 1000) * rate);
    const noise = 0.02 * Math.sin(step * 0.05 + seed);
    return 12 * decay * (1 + noise) + 0.3;
  };
  const accValue = (step: number, rate: number, seed: number) =>
    Math.min(0.98, 1 - lossValue(step, rate, seed) / 13);

  const addMetric = (runId: bigint, logGroup: string, logName: string, baseMs: number, step: number, value: number) => {
    const t = new Date(baseMs + step * 60_000).toISOString().replace('T', ' ').replace('Z', '');
    rows.push({ tenantId: org.id, projectName: FORK_PROJECT, runId: Number(runId), logGroup, logName, time: t, step, value });
  };

  // Root: steps 0-1000, rate=3.5 (nice decay from 12 → ~0.6)
  for (let s = 0; s <= 1000; s++) {
    addMetric(rootRun.id, 'eval/metrics', 'eval/metrics/loss', baseTime.getTime(), s, lossValue(s, 3.5, 0));
    addMetric(rootRun.id, 'eval/metrics', 'eval/metrics/accuracy', baseTime.getTime(), s, accValue(s, 3.5, 0));
    addMetric(rootRun.id, 'train', 'train/loss', baseTime.getTime(), s, lossValue(s, 3.5, 1) * 0.9);
  }

  // Fork A: steps 501-800, rate=2.0 (slower decay — diverges higher than root)
  for (let s = 501; s <= 800; s++) {
    const bt = baseTime.getTime() + 6 * 3600_000;
    addMetric(forkA.id, 'eval/metrics', 'eval/metrics/loss', bt, s, lossValue(s, 2.0, 10));
    addMetric(forkA.id, 'eval/metrics', 'eval/metrics/accuracy', bt, s, accValue(s, 2.0, 10));
    addMetric(forkA.id, 'train', 'train/loss', bt, s, lossValue(s, 2.0, 11) * 0.85);
  }

  // Fork B: steps 301-700, rate=5.0 (faster decay — diverges lower than root)
  for (let s = 301; s <= 700; s++) {
    const bt = baseTime.getTime() + 8 * 3600_000;
    addMetric(forkB.id, 'eval/metrics', 'eval/metrics/loss', bt, s, lossValue(s, 5.0, 20));
    addMetric(forkB.id, 'eval/metrics', 'eval/metrics/accuracy', bt, s, accValue(s, 5.0, 20));
    addMetric(forkB.id, 'train', 'train/loss', bt, s, lossValue(s, 5.0, 21) * 0.95);
  }

  // Fork C: steps 701-1000, rate=1.5 (slowest — plateaus high, diverges clearly)
  for (let s = 701; s <= 1000; s++) {
    const bt = baseTime.getTime() + 12 * 3600_000;
    addMetric(forkC.id, 'eval/metrics', 'eval/metrics/loss', bt, s, lossValue(s, 1.5, 30));
    addMetric(forkC.id, 'eval/metrics', 'eval/metrics/accuracy', bt, s, accValue(s, 1.5, 30));
    addMetric(forkC.id, 'train', 'train/loss', bt, s, lossValue(s, 1.5, 31) * 0.8);
  }

  // Root2: steps 0-800, rate=4.0 (different experiment, slightly faster than root)
  for (let s = 0; s <= 800; s++) {
    const bt = baseTime.getTime() + 2 * 3600_000;
    addMetric(rootRun2.id, 'eval/metrics', 'eval/metrics/loss', bt, s, lossValue(s, 4.0, 40));
    addMetric(rootRun2.id, 'eval/metrics', 'eval/metrics/accuracy', bt, s, accValue(s, 4.0, 40));
    addMetric(rootRun2.id, 'train', 'train/loss', bt, s, lossValue(s, 4.0, 41) * 0.88);
  }

  console.log(`Inserting ${rows.length.toLocaleString()} metric rows into ClickHouse...`);
  for (let i = 0; i < rows.length; i += 50000) {
    await ch.insert({
      table: 'mlop_metrics',
      values: rows.slice(i, i + 50000),
      format: 'JSONEachRow',
    });
  }

  await ch.close();

  console.log('\nFork lineage:');
  console.log('  Root (llm_train-v945, FRK-1): steps 0-1000');
  console.log('  ├─ Fork A (FRK-2): forked@500, own steps 501-800');
  console.log('  │  └─ Fork C (FRK-4): forked@700, own steps 701-1000');
  console.log('  └─ Fork B (FRK-3): forked@300, own steps 301-700');
  console.log('  Root2 (llm_train-v816, FRK-5): steps 0-800');
  console.log('\nView at: http://localhost:3000/o/dev-org/projects/fork-demo');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Error:', error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
