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
import { extractAndUpsertColumnKeys } from '../lib/extract-column-keys';

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
// Single-point test run gets 1 datapoint per metric (tests chart dot rendering)
const HIGH_FIDELITY_RUNS = 5;
const HIGH_FIDELITY_DATAPOINTS = 100_000; // 100k steps (realistic training run)
const STANDARD_DATAPOINTS = 1_000; // 1k steps (pagination test data)
const SINGLE_POINT_RUN_INDEX = 11; // 'single-point-test' run index
const SINGLE_POINT_DATAPOINTS = 1; // 1 step (tests single-point chart rendering)

// Metric groups and names for realistic variety
const METRIC_GROUPS = ['train', 'eval', 'system', 'custom', 'test'];
const METRIC_NAMES = [
  'loss', 'accuracy', 'lr', 'grad_norm', 'epoch_time',
  'precision', 'recall', 'f1', 'auc', 'perplexity',
  'gpu_util', 'memory_used', 'throughput', 'latency',
];

// Test metrics: parallel horizontal and slanted lines for visual debugging
const TEST_METRIC_NAMES = ['horizontal', 'slanted_up', 'slanted_down'];

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
}

// Story runs with memorable patterns (indices 0-4)
const STORY_RUNS: Record<number, StoryRunConfig> = {
  0: { name: 'baseline-experiment', model: 'resnet50', batchSize: 16, lr: 0.001 },
  1: { name: 'transformer-v1', model: 'transformer', batchSize: 32, lr: 0.001, lossSpike: { start: 0.28, end: 0.35, multiplier: 3 } },
  2: { name: 'cnn-resnet50', model: 'resnet50', batchSize: 64, lr: 0.0005, slowConvergence: true, highNoise: true },
  3: { name: 'lr-search-001', model: 'bert', batchSize: 128, lr: 0.002, earlyStop: 0.80 },
  4: { name: 'batch-size-test', model: 'gpt2', batchSize: 32, lr: 0.001, lossSpike: { start: 0.48, end: 0.55, multiplier: 5 } },
};

// Log types and their weights for random selection
const LOG_TYPE_WEIGHTS: Record<string, number> = { INFO: 60, DEBUG: 25, WARNING: 10, ERROR: 5 };

// Logs per run configuration
const HIGH_FIDELITY_LOGS = 5000;   // Story runs and high-fidelity runs
const STANDARD_LOGS = 200;         // Standard runs

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
 * For test metrics, generates parallel lines at different y-intercepts for each run.
 * For story runs (indices 0-4), injects anomalies like spikes, early stops, high noise.
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

  // Get story config for this run (if applicable)
  const storyConfig = STORY_RUNS[runIndex];

  // Early stop: return NaN to indicate no more data
  if (storyConfig?.earlyStop && progress > storyConfig.earlyStop) {
    return NaN;
  }

  // Calculate base value based on metric type
  let baseValue: number;
  switch (metricName) {
    case 'loss':
      baseValue = Math.exp(-step / (totalSteps / 3)) * 2 + Math.random() * 0.1;
      // Apply slow convergence modifier
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
      // Warmup then decay
      baseValue = step < totalSteps * 0.1
        ? 0.001 * (step / (totalSteps * 0.1))
        : 0.001 * Math.exp(-(step - totalSteps * 0.1) / totalSteps);
      break;
    case 'gpu_util':
      baseValue = 80 + Math.random() * 15;
      break;
    case 'memory_used':
      baseValue = 0.7 + Math.random() * 0.2;
      // Run 3 (lr-search-001) has increasing memory usage leading to OOM
      if (runIndex === 3) {
        baseValue = 0.5 + progress * 0.5 + Math.random() * 0.05;
      }
      break;
    case 'throughput':
      baseValue = 1000 + Math.random() * 200;
      break;
    case 'latency':
      baseValue = 10 + Math.random() * 5;
      break;
    default:
      baseValue = Math.random() * 0.01 + 0.001;
  }

  // Apply high noise modifier
  if (storyConfig?.highNoise) {
    baseValue += (Math.random() - 0.5) * 0.3;
  }

  // Apply loss spike modifier (affects loss-like metrics)
  if (storyConfig?.lossSpike && (metricName === 'loss' || metricName === 'perplexity')) {
    const { start, end, multiplier } = storyConfig.lossSpike;
    if (progress >= start && progress <= end) {
      // Create a spike that peaks in the middle and recovers
      const spikeProgress = (progress - start) / (end - start);
      const spikeFactor = Math.sin(spikeProgress * Math.PI) * (multiplier - 1) + 1;
      baseValue *= spikeFactor;
    }
  }

  // Invert spike effect for accuracy metrics (they should drop during issues)
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

  // Calculate total rows with high-fidelity subset and single-point test run
  const highFidelityRows = Math.min(HIGH_FIDELITY_RUNS, runs.length) * METRICS_PER_RUN * HIGH_FIDELITY_DATAPOINTS;
  const hasSinglePointRun = runs.length > SINGLE_POINT_RUN_INDEX;
  const singlePointRows = hasSinglePointRun ? METRICS_PER_RUN * SINGLE_POINT_DATAPOINTS : 0;
  // Standard runs exclude high-fidelity runs AND the single-point test run
  const standardRunCount = Math.max(0, runs.length - HIGH_FIDELITY_RUNS - (hasSinglePointRun ? 1 : 0));
  const standardRows = standardRunCount * METRICS_PER_RUN * STANDARD_DATAPOINTS;
  const totalRows = highFidelityRows + standardRows + singlePointRows;

  console.log(`   Seeding ClickHouse with ${totalRows.toLocaleString()} metric datapoints...`);
  console.log(`   - ${Math.min(HIGH_FIDELITY_RUNS, runs.length)} high-fidelity runs × ${METRICS_PER_RUN} metrics × ${HIGH_FIDELITY_DATAPOINTS.toLocaleString()} points`);
  console.log(`   - ${standardRunCount} standard runs × ${METRICS_PER_RUN} metrics × ${STANDARD_DATAPOINTS.toLocaleString()} points`);
  if (hasSinglePointRun) {
    console.log(`   - 1 single-point test run × ${METRICS_PER_RUN} metrics × ${SINGLE_POINT_DATAPOINTS} point`);
  }

  const BATCH_SIZE = 50000; // Larger batch for faster inserts
  let batch: Record<string, unknown>[] = [];
  let insertedCount = 0;
  const startTime = Date.now();

  for (let runIndex = 0; runIndex < runs.length; runIndex++) {
    const run = runs[runIndex];
    // Special case: single-point test run gets 1 datapoint per metric
    const datapointsForRun = runIndex === SINGLE_POINT_RUN_INDEX
      ? SINGLE_POINT_DATAPOINTS
      : runIndex < HIGH_FIDELITY_RUNS
        ? HIGH_FIDELITY_DATAPOINTS
        : STANDARD_DATAPOINTS;
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

/**
 * Generates a config prefix string for log messages.
 */
function getConfigPrefix(runIndex: number): string {
  const storyConfig = STORY_RUNS[runIndex];
  if (storyConfig) {
    return `[batch_size=${storyConfig.batchSize}, model=${storyConfig.model}]`;
  }
  // For non-story runs, generate based on index
  const batchSizes = [16, 32, 64, 128];
  const models = ['resnet50', 'transformer', 'bert', 'gpt2'];
  return `[batch_size=${batchSizes[runIndex % 4]}, model=${models[runIndex % 4]}]`;
}

/**
 * Generates training progress log messages.
 */
function generateProgressLog(runIndex: number, step: number, totalSteps: number, epoch: number, totalEpochs: number): string {
  const prefix = getConfigPrefix(runIndex);
  const loss = getMetricValue(3, step, totalSteps, runIndex); // Index 3 is first real loss metric
  if (isNaN(loss)) return ''; // Skip if early stopped

  const progress = step / totalSteps;
  const storyConfig = STORY_RUNS[runIndex];

  // Check if we're in a spike region
  if (storyConfig?.lossSpike) {
    const { start, end } = storyConfig.lossSpike;
    if (progress >= start && progress <= end) {
      const spikeProgress = (progress - start) / (end - start);
      if (spikeProgress < 0.3) {
        return `${prefix} Step ${step}: loss=${loss.toFixed(4)} (unusual increase)`;
      } else if (spikeProgress > 0.7) {
        return `${prefix} Step ${step}: loss=${loss.toFixed(4)} (recovering)`;
      }
    }
  }

  return `${prefix} Epoch ${epoch}/${totalEpochs} | loss: ${loss.toFixed(4)}`;
}

/**
 * Generates batch statistics log messages with mask_ratio and pad_ratio.
 */
function generateBatchStatsLog(runIndex: number, batchNum: number): string {
  const prefix = getConfigPrefix(runIndex);

  // Run 2 (cnn-resnet50) has high pad ratios
  let padRatio: number;
  if (runIndex === 2) {
    padRatio = 0.35 + Math.random() * 0.15; // 35-50%
  } else {
    padRatio = 0.08 + Math.random() * 0.12; // 8-20%
  }

  const maskRatio = 0.12 + Math.random() * 0.08; // 12-20%

  return `${prefix} Batch ${batchNum}: mask_ratio=${maskRatio.toFixed(2)}, pad_ratio=${padRatio.toFixed(2)}`;
}

/**
 * Generates memory usage log messages.
 */
function generateMemoryLog(runIndex: number, progress: number): string {
  const prefix = getConfigPrefix(runIndex);

  // Run 3 (lr-search-001) has increasing memory leading to OOM
  if (runIndex === 3) {
    const allocated = 10 + progress * 6; // 10GB to 16GB
    const reserved = 16.0;
    const peak = Math.min(allocated + 0.5, 15.9);
    return `${prefix} Memory: allocated=${allocated.toFixed(1)}GB, reserved=${reserved.toFixed(1)}GB, peak=${peak.toFixed(1)}GB`;
  }

  const allocated = 8 + Math.random() * 2;
  const reserved = 16.0;
  const peak = allocated + Math.random();
  return `${prefix} Memory: allocated=${allocated.toFixed(1)}GB, reserved=${reserved.toFixed(1)}GB, peak=${peak.toFixed(1)}GB`;
}

/**
 * Generates gradient statistics log messages.
 */
function generateGradientLog(runIndex: number, step: number, totalSteps: number): string {
  const prefix = getConfigPrefix(runIndex);
  const progress = step / totalSteps;
  const storyConfig = STORY_RUNS[runIndex];

  // Run 4 (batch-size-test) has gradient explosion around 50%
  if (runIndex === 4 && storyConfig?.lossSpike) {
    const { start, end } = storyConfig.lossSpike;
    if (progress >= start && progress <= end) {
      const spikeProgress = (progress - start) / (end - start);
      if (spikeProgress < 0.5) {
        const norm = 30 + Math.random() * 20; // Exploding gradient
        return `${prefix} Step ${step}: Gradient norm=${norm.toFixed(2)} (exploding)`;
      } else {
        const norm = 1 + Math.random() * 2; // Recovering
        return `${prefix} Step ${step}: Gradient norm=${norm.toFixed(2)} (stabilized)`;
      }
    }
  }

  // Normal gradient
  const norm = 1 + Math.random() * 3;
  const max = 0.1 + Math.random() * 0.2;
  return `${prefix} Gradient stats: norm=${norm.toFixed(3)}, max=${max.toFixed(3)}`;
}

/**
 * Generates special warning/error logs for story runs.
 */
function generateStoryLogs(runIndex: number, step: number, totalSteps: number): Array<{ logType: string; message: string }> {
  const logs: Array<{ logType: string; message: string }> = [];
  const prefix = getConfigPrefix(runIndex);
  const progress = step / totalSteps;
  const storyConfig = STORY_RUNS[runIndex];

  if (!storyConfig) return logs;

  // Run 1 (transformer-v1): Loss spike warning and recovery
  if (runIndex === 1 && storyConfig.lossSpike) {
    const { start, end } = storyConfig.lossSpike;
    const spikeStart = Math.floor(start * totalSteps);
    const spikeMiddle = Math.floor((start + (end - start) / 2) * totalSteps);
    const spikeEnd = Math.floor(end * totalSteps);

    if (step === spikeStart) {
      logs.push({ logType: 'WARNING', message: `${prefix} Loss increased 3x in last 100 steps` });
    }
    if (step === spikeMiddle) {
      logs.push({ logType: 'WARNING', message: `${prefix} Gradient stats: norm=8.234, max=0.523 (elevated)` });
    }
    if (step === spikeEnd) {
      logs.push({ logType: 'INFO', message: `${prefix} Training stabilized after ${Math.floor((end - start) * totalSteps)} steps` });
    }
  }

  // Run 2 (cnn-resnet50): High pad ratio warnings
  if (runIndex === 2) {
    const batchNum = Math.floor(step / 100);
    if (batchNum > 0 && step % 500 === 0) {
      const padRatio = 0.38 + Math.random() * 0.08;
      logs.push({ logType: 'WARNING', message: `${prefix} pad_ratio=${padRatio.toFixed(2)} exceeds 0.3 threshold` });
      const efficiency = Math.round((1 - padRatio) * 100);
      logs.push({ logType: 'INFO', message: `${prefix} Token efficiency: ${efficiency}% (target: 80%)` });
    }
  }

  // Run 3 (lr-search-001): OOM progression
  if (runIndex === 3) {
    if (progress > 0.70 && progress <= 0.71) {
      logs.push({ logType: 'WARNING', message: `${prefix} GPU memory at 90%` });
    }
    if (progress > 0.75 && progress <= 0.76) {
      logs.push({ logType: 'WARNING', message: `${prefix} GPU memory at 95%` });
    }
    if (progress > 0.79 && progress <= 0.80) {
      logs.push({ logType: 'ERROR', message: `${prefix} CUDA out of memory at step ${step}` });
      logs.push({ logType: 'ERROR', message: `${prefix} Training terminated - reduce batch_size or enable gradient checkpointing` });
    }
  }

  // Run 4 (batch-size-test): Gradient clipping warnings
  if (runIndex === 4 && storyConfig.lossSpike) {
    const { start, end } = storyConfig.lossSpike;
    const spikeStart = Math.floor(start * totalSteps);
    const spikeMiddle = Math.floor((start + (end - start) / 2) * totalSteps);

    if (step === spikeStart) {
      logs.push({ logType: 'WARNING', message: `${prefix} Gradient clipping activated (max_norm=10.0)` });
    }
    if (step === spikeMiddle) {
      logs.push({ logType: 'INFO', message: `${prefix} Gradient norm returning to normal range` });
    }
  }

  return logs;
}

/**
 * Seeds ClickHouse with log entries.
 * Story runs and high-fidelity runs get 5000 logs, standard runs get 200.
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
  const storyRunCount = Object.keys(STORY_RUNS).length;
  const highFidelityLogRuns = Math.min(HIGH_FIDELITY_RUNS, runs.length);
  const highFidelityLogs = highFidelityLogRuns * HIGH_FIDELITY_LOGS;
  const standardLogs = Math.max(0, runs.length - highFidelityLogRuns) * STANDARD_LOGS;
  const totalLogs = highFidelityLogs + standardLogs;

  console.log(`   Seeding ClickHouse with ~${totalLogs.toLocaleString()} log entries...`);
  console.log(`   - ${storyRunCount} story runs × ${HIGH_FIDELITY_LOGS.toLocaleString()} logs (with anomaly patterns)`);
  console.log(`   - ${highFidelityLogRuns - storyRunCount} high-fidelity runs × ${HIGH_FIDELITY_LOGS.toLocaleString()} logs`);
  console.log(`   - ${Math.max(0, runs.length - highFidelityLogRuns)} standard runs × ${STANDARD_LOGS.toLocaleString()} logs`);

  const BATCH_SIZE = 10000;
  let batch: Record<string, unknown>[] = [];
  let insertedCount = 0;
  const startTime = Date.now();

  for (let runIndex = 0; runIndex < runs.length; runIndex++) {
    const run = runs[runIndex];
    const isHighFidelity = runIndex < HIGH_FIDELITY_RUNS;
    const logsForRun = isHighFidelity ? HIGH_FIDELITY_LOGS : STANDARD_LOGS;
    const totalSteps = isHighFidelity ? HIGH_FIDELITY_DATAPOINTS : STANDARD_DATAPOINTS;
    const stepsPerLog = Math.floor(totalSteps / logsForRun);
    const totalEpochs = 100;

    const baseTime = Date.now() - totalSteps * 1000;
    let lineNumber = 0;

    for (let logIdx = 0; logIdx < logsForRun; logIdx++) {
      const step = logIdx * stepsPerLog;
      const progress = step / totalSteps;
      const epoch = Math.floor(progress * totalEpochs) + 1;
      const timestamp = new Date(baseTime + step * 1000).toISOString().replace('T', ' ').replace('Z', '');

      // Check for early stop (run 3)
      const storyConfig = STORY_RUNS[runIndex];
      if (storyConfig?.earlyStop && progress > storyConfig.earlyStop) {
        break;
      }

      // Generate story-specific logs first (warnings, errors)
      const storyLogs = generateStoryLogs(runIndex, step, totalSteps);
      for (const sLog of storyLogs) {
        batch.push({
          tenantId,
          projectName,
          runId: Number(run.id),
          logType: sLog.logType,
          time: timestamp,
          lineNumber: lineNumber++,
          message: sLog.message,
          step,
        });
      }

      // Generate regular logs based on position in training
      let logType = getRandomLogType();
      let message: string;

      const msgType = logIdx % 10;
      switch (msgType) {
        case 0:
        case 1:
        case 2:
          // Progress logs (30%)
          message = generateProgressLog(runIndex, step, totalSteps, epoch, totalEpochs);
          logType = 'INFO';
          break;
        case 3:
        case 4:
          // Batch stats (20%)
          message = generateBatchStatsLog(runIndex, Math.floor(step / 100));
          logType = 'DEBUG';
          break;
        case 5:
          // Memory logs (10%)
          message = generateMemoryLog(runIndex, progress);
          logType = 'DEBUG';
          break;
        case 6:
          // Gradient logs (10%)
          message = generateGradientLog(runIndex, step, totalSteps);
          logType = 'DEBUG';
          break;
        default:
          // Generic training logs (30%)
          const prefix = getConfigPrefix(runIndex);
          const templates = [
            `${prefix} Checkpoint saved at step ${step}`,
            `${prefix} Learning rate: ${(0.001 * Math.exp(-progress)).toExponential(4)}`,
            `${prefix} Throughput: ${Math.round(800 + Math.random() * 400)} samples/sec`,
            `${prefix} Data loader: ${Math.round(10 + Math.random() * 20)}ms avg batch time`,
          ];
          message = templates[logIdx % templates.length];
          logType = 'INFO';
      }

      if (message) {
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
      }

      if (batch.length >= BATCH_SIZE) {
        await clickhouse.insert({
          table: 'mlop_logs',
          values: batch,
          format: 'JSONEachRow',
        });
        insertedCount += batch.length;
        batch = [];

        const elapsed = (Date.now() - startTime) / 1000;
        const rate = insertedCount / elapsed;
        console.log(`   Log progress: ${insertedCount.toLocaleString()} logs (${Math.round(rate).toLocaleString()} rows/sec)`);
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

/**
 * Backfills mlop_metric_summaries from mlop_metrics via INSERT...SELECT.
 * Only runs if summaries table is empty. Idempotent on repeat calls.
 */
async function backfillMetricSummaries(
  tenantId: string,
  projectName: string,
): Promise<void> {
  const clickhouseUrl = process.env.CLICKHOUSE_URL;
  const clickhouseUser = process.env.CLICKHOUSE_USER || 'default';
  const clickhousePassword = process.env.CLICKHOUSE_PASSWORD || '';

  if (!clickhouseUrl) {
    console.log('   CLICKHOUSE_URL not set, skipping metric summaries backfill');
    return;
  }

  const clickhouse = createClient({
    url: clickhouseUrl,
    username: clickhouseUser,
    password: clickhousePassword,
  });

  try {
    const countResult = await clickhouse.query({
      query: `SELECT count() as cnt FROM mlop_metric_summaries WHERE tenantId = {tenantId:String} AND projectName = {projectName:String}`,
      query_params: { tenantId, projectName },
      format: 'JSONEachRow',
    });
    const rows = (await countResult.json()) as Array<{ cnt: string }>;
    const existingCount = parseInt(rows[0]?.cnt || '0', 10);

    if (existingCount > 0) {
      console.log(`   Metric summaries already populated (${existingCount} rows)`);
      return;
    }

    console.log('   Backfilling metric summaries from mlop_metrics...');
    const startTime = Date.now();

    await clickhouse.command({
      query: `INSERT INTO mlop_metric_summaries
        SELECT tenantId, projectName, runId, logName,
          min(value), max(value), sum(value),
          toUInt64(count()),
          argMaxState(value, step),
          sum(value * value)
        FROM mlop_metrics
        WHERE tenantId = {tenantId:String} AND projectName = {projectName:String}
        GROUP BY tenantId, projectName, runId, logName`,
      query_params: { tenantId, projectName },
    });

    const newCountResult = await clickhouse.query({
      query: `SELECT count() as cnt FROM mlop_metric_summaries WHERE tenantId = {tenantId:String} AND projectName = {projectName:String}`,
      query_params: { tenantId, projectName },
      format: 'JSONEachRow',
    });
    const newRows = (await newCountResult.json()) as Array<{ cnt: string }>;
    const newCount = parseInt(newRows[0]?.cnt || '0', 10);

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`   Backfilled ${newCount} metric summary rows in ${elapsed}s`);
  } finally {
    await clickhouse.close();
  }
}

/**
 * Backfills ProjectColumnKey and RunFieldValue for all runs in a project.
 * Uses the shared extractAndUpsertColumnKeys() which handles skipDuplicates.
 */
async function backfillColumnKeys(
  runs: { id: bigint; config: unknown; systemMetadata: unknown }[],
  orgId: string,
  projectId: bigint,
): Promise<void> {
  console.log(`   Backfilling column keys and field values for ${runs.length} runs...`);
  const startTime = Date.now();
  let processed = 0;

  for (const run of runs) {
    await extractAndUpsertColumnKeys(
      prisma,
      orgId,
      projectId,
      run.config,
      run.systemMetadata,
      run.id,
    );
    processed++;
    if (processed % 50 === 0) {
      console.log(`   Column keys progress: ${processed}/${runs.length}`);
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`   Backfilled column keys for ${processed} runs in ${elapsed}s`);
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

  // Use mlpi_ (insecure) prefix so key is stored plaintext for dev convenience
  const apiKeyValue = `mlpi_dev_${nanoid(32)}`;

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
    // single-point-test at index 11 tests chart rendering of single data points
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
      'single-point-test', // Index 11 - Single datapoint per metric for chart dot rendering test
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
        config: STORY_RUNS[i]
          ? {
              model: STORY_RUNS[i].model,
              lr: STORY_RUNS[i].lr,
              batch_size: STORY_RUNS[i].batchSize,
              epochs: 100,
            }
          : {
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
  // Order by ID to ensure story runs (1-5) are processed first
  const allRuns = await prisma.runs.findMany({
    where: {
      projectId: project.id,
      organizationId: org.id,
    },
    select: { id: true, name: true },
    orderBy: { id: 'asc' },
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

  // Seed ClickHouse logs with story-driven patterns
  await seedClickHouseLogs(allRuns, org.id, project.name);

  // Backfill metric summaries (MV only captures future inserts)
  console.log('\n6. Backfilling metric summaries...');
  await backfillMetricSummaries(org.id, project.name);

  // Backfill column keys and field values for run table server-side filtering
  console.log('\n7. Backfilling column keys and field values...');
  const runsWithConfig = await prisma.runs.findMany({
    where: { projectId: project.id, organizationId: org.id },
    select: { id: true, config: true, systemMetadata: true },
    orderBy: { id: 'asc' },
  });
  await backfillColumnKeys(runsWithConfig, org.id, project.id);

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
