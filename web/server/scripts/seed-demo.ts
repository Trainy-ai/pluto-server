/**
 * Seed demo data for the Pluto demo instance.
 * Creates a demo user with 5000 pre-populated runs and metrics.
 *
 * Features:
 * - 5000 total runs across the project
 * - 10 high-fidelity runs with 100k datapoints each (for performance showcase)
 * - 50 story runs with anomaly patterns (loss spikes, OOM, gradient explosion)
 * - 4940 standard runs with 500-1000 datapoints each
 * - Realistic console logs with training output patterns
 *
 * Usage:
 *   pnpm exec tsx scripts/seed-demo.ts
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
  name: 'Demo User',
};

const DEV_ORG = {
  name: 'Demo Organization',
  slug: 'dev-org',
};

const DEV_PROJECT = 'my-ml-project';

// ============================================================================
// Demo Configuration
// ============================================================================

const TOTAL_RUNS = 5000;
const METRICS_PER_RUN = 20; // Reduced for demo to speed up seeding

// High-fidelity runs: first 10 runs get 100k datapoints (realistic training runs)
const HIGH_FIDELITY_RUNS = 10;
const HIGH_FIDELITY_DATAPOINTS = 100_000;

// Story runs: runs 0-49 have interesting patterns for Claude to analyze
const STORY_RUNS_COUNT = 50;
const STORY_DATAPOINTS = 10_000;

// Standard runs: remaining runs get 500-1000 datapoints
const STANDARD_MIN_DATAPOINTS = 500;
const STANDARD_MAX_DATAPOINTS = 1000;

// Metric groups and names for realistic variety
const METRIC_GROUPS = ['train', 'eval', 'system', 'custom'];
const METRIC_NAMES = [
  'loss', 'accuracy', 'lr', 'grad_norm', 'epoch_time',
  'precision', 'recall', 'f1', 'auc', 'perplexity',
  'gpu_util', 'memory_used', 'throughput', 'latency',
];

// Logs per run configuration
const HIGH_FIDELITY_LOGS = 5000;
const STORY_LOGS = 2000;
const STANDARD_LOGS = 100;

// Log types and their weights for random selection
const LOG_TYPE_WEIGHTS: Record<string, number> = { INFO: 60, DEBUG: 25, WARNING: 10, ERROR: 5 };

// ============================================================================
// Story Runs Configuration - Runs with interesting patterns for Claude to analyze
// ============================================================================

interface StoryRunConfig {
  name: string;
  model: string;
  batchSize: number;
  lr: number;
  // Metric anomaly patterns
  lossSpike?: { start: number; end: number; multiplier: number };
  earlyStop?: number;  // Stop generating data at this progress %
  highNoise?: boolean;
  slowConvergence?: boolean;
  gradientExplosion?: { start: number; end: number };
  oomEvent?: number; // Progress % where OOM occurs
}

// Story runs with memorable patterns (first 50 runs)
function getStoryConfig(index: number): StoryRunConfig | null {
  const storyConfigs: StoryRunConfig[] = [
    // High-fidelity showcase runs (0-9)
    { name: 'baseline-experiment', model: 'resnet50', batchSize: 16, lr: 0.001 },
    { name: 'transformer-v1', model: 'transformer', batchSize: 32, lr: 0.001, lossSpike: { start: 0.28, end: 0.35, multiplier: 3 } },
    { name: 'cnn-resnet50', model: 'resnet50', batchSize: 64, lr: 0.0005, slowConvergence: true, highNoise: true },
    { name: 'lr-search-001', model: 'bert', batchSize: 128, lr: 0.002, oomEvent: 0.80 },
    { name: 'batch-size-test', model: 'gpt2', batchSize: 32, lr: 0.001, gradientExplosion: { start: 0.48, end: 0.55 } },
    { name: 'adam-optimizer', model: 'vit', batchSize: 64, lr: 0.0001 },
    { name: 'sgd-momentum', model: 'efficientnet', batchSize: 32, lr: 0.01, highNoise: true },
    { name: 'warmup-cosine', model: 'llama', batchSize: 16, lr: 0.0003 },
    { name: 'no-warmup-test', model: 'mistral', batchSize: 8, lr: 0.001, lossSpike: { start: 0.05, end: 0.15, multiplier: 2 } },
    { name: 'large-batch-ddp', model: 'gpt2-xl', batchSize: 256, lr: 0.0005 },

    // Additional story runs (10-49) with various patterns
    { name: 'overfitting-demo', model: 'resnet18', batchSize: 16, lr: 0.01, highNoise: true },
    { name: 'underfitting-demo', model: 'linear', batchSize: 64, lr: 0.0001, slowConvergence: true },
    { name: 'nan-loss-crash', model: 'transformer', batchSize: 128, lr: 0.1, earlyStop: 0.15 },
    { name: 'memory-leak-run', model: 'bert-large', batchSize: 32, lr: 0.001, oomEvent: 0.60 },
    { name: 'gradient-clip-needed', model: 'gpt2', batchSize: 64, lr: 0.005, gradientExplosion: { start: 0.20, end: 0.30 } },
    { name: 'perfect-convergence', model: 'resnet50', batchSize: 32, lr: 0.001 },
    { name: 'oscillating-loss', model: 'vit', batchSize: 16, lr: 0.005, highNoise: true },
    { name: 'plateau-then-improve', model: 'efficientnet', batchSize: 64, lr: 0.001, slowConvergence: true },
    { name: 'fast-early-stop', model: 'mobilenet', batchSize: 128, lr: 0.01, earlyStop: 0.25 },
    { name: 'double-descent', model: 'transformer', batchSize: 32, lr: 0.001, lossSpike: { start: 0.40, end: 0.50, multiplier: 1.5 } },

    // More story runs (20-49)
    ...Array.from({ length: 30 }, (_, i) => ({
      name: `experiment-${String(i + 20).padStart(3, '0')}`,
      model: ['resnet50', 'transformer', 'bert', 'gpt2', 'vit', 'llama'][i % 6],
      batchSize: [16, 32, 64, 128][i % 4],
      lr: [0.001, 0.0005, 0.0001, 0.002][i % 4],
      ...(i % 5 === 0 ? { lossSpike: { start: 0.3 + (i % 3) * 0.1, end: 0.4 + (i % 3) * 0.1, multiplier: 2 } } : {}),
      ...(i % 7 === 0 ? { highNoise: true } : {}),
      ...(i % 11 === 0 ? { slowConvergence: true } : {}),
    })),
  ];

  return index < storyConfigs.length ? storyConfigs[index] : null;
}

/**
 * Generates a metric name from group and name arrays.
 */
function getMetricName(metricIndex: number): { group: string; name: string } {
  const groupIndex = Math.floor(metricIndex / METRIC_NAMES.length) % METRIC_GROUPS.length;
  const nameIndex = metricIndex % METRIC_NAMES.length;
  const suffix = Math.floor(metricIndex / (METRIC_GROUPS.length * METRIC_NAMES.length));
  return {
    group: METRIC_GROUPS[groupIndex],
    name: `${METRIC_GROUPS[groupIndex]}/${METRIC_NAMES[nameIndex]}${suffix > 0 ? `_${suffix}` : ''}`,
  };
}

/**
 * Selects a random log type based on weights.
 */
function getRandomLogType(): string {
  const total = Object.values(LOG_TYPE_WEIGHTS).reduce((a, b) => a + b, 0);
  let random = Math.random() * total;
  for (const [type, weight] of Object.entries(LOG_TYPE_WEIGHTS)) {
    random -= weight;
    if (random <= 0) return type;
  }
  return 'INFO';
}

/**
 * Generates a realistic metric value based on metric type, step, and run story.
 */
function getMetricValue(metricIndex: number, step: number, totalSteps: number, runIndex: number = 0): number {
  const nameIndex = metricIndex % METRIC_NAMES.length;
  const metricName = METRIC_NAMES[nameIndex];
  const progress = step / totalSteps;

  const storyConfig = getStoryConfig(runIndex);

  // Early stop: return NaN to indicate no more data
  if (storyConfig?.earlyStop && progress > storyConfig.earlyStop) {
    return NaN;
  }

  // OOM event: return NaN after OOM
  if (storyConfig?.oomEvent && progress > storyConfig.oomEvent) {
    return NaN;
  }

  // Calculate base value based on metric type
  let baseValue: number;
  switch (metricName) {
    case 'loss':
      baseValue = Math.exp(-step / (totalSteps / 3)) * 2 + Math.random() * 0.1;
      if (storyConfig?.slowConvergence) {
        baseValue = Math.exp(-step / (totalSteps / 1.5)) * 2.5 + Math.random() * 0.1;
      }
      break;
    case 'accuracy':
    case 'precision':
    case 'recall':
    case 'f1':
    case 'auc':
      baseValue = 0.5 + progress * 0.45 + Math.random() * 0.02;
      if (storyConfig?.slowConvergence) {
        baseValue = 0.4 + progress * 0.35 + Math.random() * 0.02;
      }
      break;
    case 'perplexity':
      baseValue = 100 * Math.exp(-step / (totalSteps / 2)) + 10 + Math.random() * 5;
      break;
    case 'lr':
      baseValue = step < totalSteps * 0.1
        ? 0.001 * (step / (totalSteps * 0.1))
        : 0.001 * Math.exp(-(step - totalSteps * 0.1) / totalSteps);
      break;
    case 'gpu_util':
      baseValue = 80 + Math.random() * 15;
      break;
    case 'memory_used':
      baseValue = 0.7 + Math.random() * 0.2;
      if (storyConfig?.oomEvent) {
        baseValue = 0.5 + progress * 0.5 + Math.random() * 0.05;
      }
      break;
    case 'throughput':
      baseValue = 1000 + Math.random() * 200;
      break;
    case 'latency':
      baseValue = 10 + Math.random() * 5;
      break;
    case 'grad_norm':
      baseValue = 1 + Math.random() * 3;
      if (storyConfig?.gradientExplosion) {
        const { start, end } = storyConfig.gradientExplosion;
        if (progress >= start && progress <= end) {
          const spikeProgress = (progress - start) / (end - start);
          baseValue = 1 + Math.sin(spikeProgress * Math.PI) * 50;
        }
      }
      break;
    default:
      baseValue = Math.random() * 0.01 + 0.001;
  }

  // Apply high noise modifier
  if (storyConfig?.highNoise) {
    baseValue += (Math.random() - 0.5) * 0.3;
  }

  // Apply loss spike modifier
  if (storyConfig?.lossSpike && (metricName === 'loss' || metricName === 'perplexity')) {
    const { start, end, multiplier } = storyConfig.lossSpike;
    if (progress >= start && progress <= end) {
      const spikeProgress = (progress - start) / (end - start);
      const spikeFactor = Math.sin(spikeProgress * Math.PI) * (multiplier - 1) + 1;
      baseValue *= spikeFactor;
    }
  }

  // Invert spike effect for accuracy metrics
  if (storyConfig?.lossSpike && ['accuracy', 'precision', 'recall', 'f1', 'auc'].includes(metricName)) {
    const { start, end, multiplier } = storyConfig.lossSpike;
    if (progress >= start && progress <= end) {
      const spikeProgress = (progress - start) / (end - start);
      const dropFactor = 1 - Math.sin(spikeProgress * Math.PI) * (1 - 1/multiplier);
      baseValue *= dropFactor;
    }
  }

  return baseValue;
}

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

  // Calculate total rows
  let totalRows = 0;
  for (let i = 0; i < runs.length; i++) {
    const datapoints = getDatapointsForRun(i);
    totalRows += METRICS_PER_RUN * datapoints;
  }

  console.log(`   Seeding ClickHouse with ~${totalRows.toLocaleString()} metric datapoints...`);
  console.log(`   - ${HIGH_FIDELITY_RUNS} high-fidelity runs × ${METRICS_PER_RUN} metrics × ${HIGH_FIDELITY_DATAPOINTS.toLocaleString()} points`);
  console.log(`   - ${STORY_RUNS_COUNT - HIGH_FIDELITY_RUNS} story runs × ${METRICS_PER_RUN} metrics × ${STORY_DATAPOINTS.toLocaleString()} points`);
  console.log(`   - ${runs.length - STORY_RUNS_COUNT} standard runs × ${METRICS_PER_RUN} metrics × ~${STANDARD_MIN_DATAPOINTS}-${STANDARD_MAX_DATAPOINTS} points`);

  const BATCH_SIZE = 50000;
  let batch: Record<string, unknown>[] = [];
  let insertedCount = 0;
  const startTime = Date.now();
  let lastProgressLog = Date.now();

  for (let runIndex = 0; runIndex < runs.length; runIndex++) {
    const run = runs[runIndex];
    const datapointsForRun = getDatapointsForRun(runIndex);
    const baseTime = Date.now() - datapointsForRun * 1000;

    for (let m = 0; m < METRICS_PER_RUN; m++) {
      const { group, name } = getMetricName(m);

      for (let step = 0; step < datapointsForRun; step++) {
        const value = getMetricValue(m, step, datapointsForRun, runIndex);
        if (isNaN(value)) continue; // Skip NaN values (early stop, OOM)

        batch.push({
          tenantId,
          projectName,
          runId: Number(run.id),
          logGroup: group,
          logName: name,
          time: new Date(baseTime + step * 1000).toISOString().replace('T', ' ').replace('Z', ''),
          step,
          value,
        });

        if (batch.length >= BATCH_SIZE) {
          await clickhouse.insert({
            table: 'mlop_metrics',
            values: batch,
            format: 'JSONEachRow',
          });
          insertedCount += batch.length;
          batch = [];

          // Progress logging every 30 seconds
          if (Date.now() - lastProgressLog > 30000) {
            const elapsed = (Date.now() - startTime) / 1000;
            const rate = insertedCount / elapsed;
            const remaining = (totalRows - insertedCount) / rate;
            console.log(`   Metrics progress: ${insertedCount.toLocaleString()}/${totalRows.toLocaleString()} (${Math.round(rate).toLocaleString()} rows/sec, ~${Math.round(remaining)}s remaining)`);
            lastProgressLog = Date.now();
          }
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

/**
 * Gets the number of datapoints for a run based on its index.
 */
function getDatapointsForRun(runIndex: number): number {
  if (runIndex < HIGH_FIDELITY_RUNS) {
    return HIGH_FIDELITY_DATAPOINTS;
  }
  if (runIndex < STORY_RUNS_COUNT) {
    return STORY_DATAPOINTS;
  }
  // Standard runs get random datapoints between min and max
  return STANDARD_MIN_DATAPOINTS + Math.floor(Math.random() * (STANDARD_MAX_DATAPOINTS - STANDARD_MIN_DATAPOINTS));
}

/**
 * Gets the number of logs for a run based on its index.
 */
function getLogsForRun(runIndex: number): number {
  if (runIndex < HIGH_FIDELITY_RUNS) {
    return HIGH_FIDELITY_LOGS;
  }
  if (runIndex < STORY_RUNS_COUNT) {
    return STORY_LOGS;
  }
  return STANDARD_LOGS;
}

/**
 * Generates a config prefix string for log messages.
 */
function getConfigPrefix(runIndex: number): string {
  const storyConfig = getStoryConfig(runIndex);
  if (storyConfig) {
    return `[batch_size=${storyConfig.batchSize}, model=${storyConfig.model}]`;
  }
  const batchSizes = [16, 32, 64, 128];
  const models = ['resnet50', 'transformer', 'bert', 'gpt2'];
  return `[batch_size=${batchSizes[runIndex % 4]}, model=${models[runIndex % 4]}]`;
}

/**
 * Generates training log messages.
 */
function generateLogMessage(runIndex: number, step: number, totalSteps: number, logIdx: number): { logType: string; message: string } {
  const prefix = getConfigPrefix(runIndex);
  const progress = step / totalSteps;
  const storyConfig = getStoryConfig(runIndex);

  // Check for early stop or OOM
  if (storyConfig?.earlyStop && progress > storyConfig.earlyStop) {
    return { logType: 'ERROR', message: `${prefix} Training stopped: NaN loss detected` };
  }
  if (storyConfig?.oomEvent && progress >= storyConfig.oomEvent && progress < storyConfig.oomEvent + 0.01) {
    return { logType: 'ERROR', message: `${prefix} CUDA out of memory. Tried to allocate 2.00 GiB` };
  }

  // Generate different log types based on position
  const msgType = logIdx % 10;
  switch (msgType) {
    case 0:
    case 1:
    case 2: {
      // Progress logs (30%)
      const epoch = Math.floor(progress * 100) + 1;
      const loss = getMetricValue(0, step, totalSteps, runIndex);
      if (isNaN(loss)) return { logType: 'INFO', message: `${prefix} Epoch ${epoch}/100` };
      return { logType: 'INFO', message: `${prefix} Epoch ${epoch}/100 | loss: ${loss.toFixed(4)}` };
    }
    case 3:
    case 4: {
      // Batch stats (20%)
      const batchNum = Math.floor(step / 100);
      const maskRatio = 0.12 + Math.random() * 0.08;
      const padRatio = storyConfig?.highNoise ? 0.35 + Math.random() * 0.15 : 0.08 + Math.random() * 0.12;
      return { logType: 'DEBUG', message: `${prefix} Batch ${batchNum}: mask_ratio=${maskRatio.toFixed(2)}, pad_ratio=${padRatio.toFixed(2)}` };
    }
    case 5: {
      // Memory logs (10%)
      const allocated = storyConfig?.oomEvent ? 10 + progress * 6 : 8 + Math.random() * 2;
      return { logType: 'DEBUG', message: `${prefix} Memory: allocated=${allocated.toFixed(1)}GB, reserved=16.0GB` };
    }
    case 6: {
      // Gradient logs (10%)
      let norm = 1 + Math.random() * 3;
      if (storyConfig?.gradientExplosion) {
        const { start, end } = storyConfig.gradientExplosion;
        if (progress >= start && progress <= end) {
          norm = 30 + Math.random() * 20;
          return { logType: 'WARNING', message: `${prefix} Gradient norm=${norm.toFixed(2)} (exploding)` };
        }
      }
      return { logType: 'DEBUG', message: `${prefix} Gradient stats: norm=${norm.toFixed(3)}` };
    }
    default: {
      // Generic training logs (30%)
      const templates = [
        `${prefix} Checkpoint saved at step ${step}`,
        `${prefix} Learning rate: ${(0.001 * Math.exp(-progress)).toExponential(4)}`,
        `${prefix} Throughput: ${Math.round(800 + Math.random() * 400)} samples/sec`,
        `${prefix} Data loader: ${Math.round(10 + Math.random() * 20)}ms avg batch time`,
      ];
      return { logType: 'INFO', message: templates[logIdx % templates.length] };
    }
  }
}

/**
 * Seeds ClickHouse with log entries.
 */
async function seedClickHouseLogs(
  runs: { id: bigint; name: string }[],
  tenantId: string,
  projectName: string,
): Promise<void> {
  const clickhouseUrl = process.env.CLICKHOUSE_URL;
  const clickhouseUser = process.env.CLICKHOUSE_USER || 'default';
  const clickhousePassword = process.env.CLICKHOUSE_PASSWORD || '';

  if (!clickhouseUrl) {
    console.log('   CLICKHOUSE_URL not set, skipping ClickHouse log seeding');
    return;
  }

  const clickhouse = createClient({
    url: clickhouseUrl,
    username: clickhouseUser,
    password: clickhousePassword,
  });

  // Calculate total logs
  let totalLogs = 0;
  for (let i = 0; i < runs.length; i++) {
    totalLogs += getLogsForRun(i);
  }

  console.log(`   Seeding ClickHouse with ~${totalLogs.toLocaleString()} log entries...`);

  const BATCH_SIZE = 10000;
  let batch: Record<string, unknown>[] = [];
  let insertedCount = 0;
  const startTime = Date.now();
  let lastProgressLog = Date.now();

  for (let runIndex = 0; runIndex < runs.length; runIndex++) {
    const run = runs[runIndex];
    const logsForRun = getLogsForRun(runIndex);
    const totalSteps = getDatapointsForRun(runIndex);
    const stepsPerLog = Math.floor(totalSteps / logsForRun);
    const baseTime = Date.now() - totalSteps * 1000;
    let lineNumber = 0;

    for (let logIdx = 0; logIdx < logsForRun; logIdx++) {
      const step = logIdx * stepsPerLog;
      const timestamp = new Date(baseTime + step * 1000).toISOString().replace('T', ' ').replace('Z', '');

      const { logType, message } = generateLogMessage(runIndex, step, totalSteps, logIdx);

      batch.push({
        tenantId,
        projectName,
        runId: Number(run.id),
        logType,
        time: timestamp,
        lineNumber: lineNumber++,
        message,
        step,
      });

      if (batch.length >= BATCH_SIZE) {
        await clickhouse.insert({
          table: 'mlop_logs',
          values: batch,
          format: 'JSONEachRow',
        });
        insertedCount += batch.length;
        batch = [];

        if (Date.now() - lastProgressLog > 30000) {
          const elapsed = (Date.now() - startTime) / 1000;
          const rate = insertedCount / elapsed;
          console.log(`   Logs progress: ${insertedCount.toLocaleString()}/${totalLogs.toLocaleString()} (${Math.round(rate).toLocaleString()} rows/sec)`);
          lastProgressLog = Date.now();
        }
      }
    }
  }

  if (batch.length > 0) {
    await clickhouse.insert({
      table: 'mlop_logs',
      values: batch,
      format: 'JSONEachRow',
    });
    insertedCount += batch.length;
  }

  await clickhouse.close();
  const totalTime = (Date.now() - startTime) / 1000;
  console.log(`   Seeded ${insertedCount.toLocaleString()} log entries in ${totalTime.toFixed(1)}s`);
}

async function main() {
  console.log('Seeding demo data...\n');
  console.log(`Target: ${TOTAL_RUNS} runs with metrics and logs\n`);

  // 1. Create demo user with password auth
  console.log('1. Creating demo user...');
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
        stripeCustomerId: `cus_demo_${org.id.substring(0, 8)}`,
        stripeSubscriptionId: `sub_demo_${org.id.substring(0, 8)}`,
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
    where: { organizationId: org.id, name: 'Demo API Key' },
  });

  const apiKeyValue = `mlpi_demo_${nanoid(32)}`;

  if (!apiKey) {
    apiKey = await prisma.apiKey.create({
      data: {
        id: nanoid(),
        key: apiKeyValue,
        keyString: apiKeyValue.slice(0, 15) + '...',
        name: 'Demo API Key',
        organizationId: org.id,
        userId: user.id,
        isHashed: false,
        createdAt: new Date(),
      },
    });
    console.log(`   Created API key: ${apiKeyValue}`);
  } else {
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

  // 5. Create runs
  console.log(`\n5. Creating ${TOTAL_RUNS} runs...`);

  const existingRunCount = await prisma.runs.count({
    where: { projectId: project.id, organizationId: org.id },
  });

  const runsToCreate = TOTAL_RUNS - existingRunCount;

  if (runsToCreate > 0) {
    // Base date: runs are spread over time
    const baseDate = new Date(Date.now() - TOTAL_RUNS * 60 * 60 * 1000);

    // Create runs in batches
    const BATCH_SIZE = 500;
    let createdCount = 0;

    for (let batchStart = existingRunCount; batchStart < TOTAL_RUNS; batchStart += BATCH_SIZE) {
      const batchEnd = Math.min(batchStart + BATCH_SIZE, TOTAL_RUNS);
      const runData = [];

      for (let i = batchStart; i < batchEnd; i++) {
        const storyConfig = getStoryConfig(i);
        const runName = storyConfig?.name || `experiment-${String(i).padStart(4, '0')}`;

        // Generate tags - story runs get special tags
        const tags: string[] = [`run-tag-${String(i).padStart(4, '0')}`];
        if (i < HIGH_FIDELITY_RUNS) tags.push('high-fidelity');
        if (i < STORY_RUNS_COUNT) tags.push('story-run');
        if (storyConfig?.lossSpike) tags.push('loss-spike');
        if (storyConfig?.oomEvent) tags.push('oom');
        if (storyConfig?.gradientExplosion) tags.push('gradient-explosion');

        runData.push({
          name: runName,
          organizationId: org.id,
          projectId: project.id,
          createdById: user.id,
          creatorApiKeyId: apiKey.id,
          status: i % 10 === 0 ? ('RUNNING' as const) : ('COMPLETED' as const),
          tags,
          config: storyConfig
            ? {
                model: storyConfig.model,
                lr: storyConfig.lr,
                batch_size: storyConfig.batchSize,
                epochs: 100,
              }
            : {
                model: ['resnet50', 'transformer', 'bert', 'gpt2', 'vit', 'llama'][i % 6],
                lr: 0.001 * ((i % 10) + 1),
                batch_size: [16, 32, 64, 128][i % 4],
                epochs: 100,
              },
          systemMetadata: {
            hostname: `demo-machine-${i % 5}`,
            gpu: ['A100', 'V100', 'RTX 4090', 'H100'][i % 4],
            python: '3.11',
          },
        });
      }

      await prisma.runs.createMany({
        data: runData,
        skipDuplicates: true,
      });

      createdCount += runData.length;
      console.log(`   Created ${createdCount}/${runsToCreate} runs...`);
    }

    // Update timestamps to spread runs over time
    console.log(`   Updating run timestamps...`);
    const allRuns = await prisma.runs.findMany({
      where: { projectId: project.id, organizationId: org.id },
      orderBy: { id: 'asc' },
      select: { id: true },
    });

    for (let i = 0; i < allRuns.length; i++) {
      const createdAt = new Date(baseDate.getTime() + i * 60 * 60 * 1000);
      await prisma.$executeRaw`UPDATE "runs" SET "createdAt" = ${createdAt}, "updatedAt" = ${createdAt} WHERE id = ${allRuns[i].id}`;

      if ((i + 1) % 1000 === 0) {
        console.log(`   Updated ${i + 1}/${allRuns.length} timestamps...`);
      }
    }

    console.log(`   Created ${runsToCreate} runs (total: ${TOTAL_RUNS})`);
  } else {
    console.log(`   ${existingRunCount} runs already exist`);
  }

  // Fetch ALL runs for ClickHouse seeding
  const allRuns = await prisma.runs.findMany({
    where: { projectId: project.id, organizationId: org.id },
    select: { id: true, name: true },
    orderBy: { id: 'asc' },
  });

  // Register metric names
  console.log('\n6. Registering metric names...');
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

  // Register in batches
  const LOG_BATCH_SIZE = 10000;
  for (let i = 0; i < runLogData.length; i += LOG_BATCH_SIZE) {
    const batch = runLogData.slice(i, i + LOG_BATCH_SIZE);
    await prisma.runLogs.createMany({
      data: batch,
      skipDuplicates: true,
    });
    console.log(`   Registered ${Math.min(i + LOG_BATCH_SIZE, runLogData.length)}/${runLogData.length} metric names...`);
  }

  // Seed ClickHouse metrics
  console.log('\n7. Seeding ClickHouse metrics...');
  await seedClickHouseMetrics(allRuns, org.id, project.name);

  // Seed ClickHouse logs
  console.log('\n8. Seeding ClickHouse logs...');
  await seedClickHouseLogs(allRuns, org.id, project.name);

  console.log('\n' + '='.repeat(60));
  console.log('Demo data seeded successfully!\n');
  console.log('Login credentials:');
  console.log(`   Email:    ${DEV_USER.email}`);
  console.log(`   Password: ${DEV_USER.password}`);
  console.log(`   Org URL:  https://demo.pluto.trainy.ai/o/${DEV_ORG.slug}`);
  console.log(`   API Key:  ${apiKeyValue}`);
  console.log('\nData summary:');
  console.log(`   Total runs:        ${TOTAL_RUNS}`);
  console.log(`   High-fidelity:     ${HIGH_FIDELITY_RUNS} runs × 100k datapoints`);
  console.log(`   Story runs:        ${STORY_RUNS_COUNT} runs with patterns`);
  console.log(`   Standard runs:     ${TOTAL_RUNS - STORY_RUNS_COUNT} runs`);
  console.log('='.repeat(60) + '\n');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Error during seeding:', error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
