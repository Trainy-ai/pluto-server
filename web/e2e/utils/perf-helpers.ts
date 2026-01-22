import type { Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

export interface PerfMetric {
  name: string;
  value: number;
  unit: string;
  threshold?: number;
  passed?: boolean;
}

export interface PerfResults {
  timestamp: string;
  commit?: string;
  metrics: PerfMetric[];
  summary: {
    total: number;
    passed: number;
    failed: number;
  };
}

/**
 * Measures page load performance metrics using the Performance API.
 */
export async function measurePageLoad(page: Page): Promise<{
  domContentLoaded: number;
  loadComplete: number;
  firstPaint: number;
  firstContentfulPaint: number;
}> {
  return await page.evaluate(() => {
    const navigation = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
    const paintEntries = performance.getEntriesByType('paint');

    const firstPaint = paintEntries.find(e => e.name === 'first-paint')?.startTime ?? 0;
    const firstContentfulPaint = paintEntries.find(e => e.name === 'first-contentful-paint')?.startTime ?? 0;

    return {
      domContentLoaded: navigation.domContentLoadedEventEnd - navigation.startTime,
      loadComplete: navigation.loadEventEnd - navigation.startTime,
      firstPaint,
      firstContentfulPaint,
    };
  });
}

/**
 * Measures Largest Contentful Paint (LCP) by setting up a PerformanceObserver.
 * Must be called before navigating to the page.
 */
export async function setupLCPMeasurement(page: Page): Promise<void> {
  await page.addInitScript(() => {
    (window as any).__LCP_VALUE__ = 0;
    new PerformanceObserver((entryList) => {
      const entries = entryList.getEntries();
      const lastEntry = entries[entries.length - 1];
      (window as any).__LCP_VALUE__ = lastEntry.startTime;
    }).observe({ type: 'largest-contentful-paint', buffered: true });
  });
}

/**
 * Gets the measured LCP value after page load.
 */
export async function getLCP(page: Page): Promise<number> {
  // Wait a bit for LCP to stabilize
  await page.waitForTimeout(500);
  return await page.evaluate(() => (window as any).__LCP_VALUE__ ?? 0);
}

/**
 * Measures time until a specific selector becomes visible.
 */
export async function measureTimeToSelector(
  page: Page,
  selector: string,
  options?: { timeout?: number }
): Promise<number> {
  const start = performance.now();
  await page.waitForSelector(selector, { state: 'visible', timeout: options?.timeout ?? 30000 });
  return performance.now() - start;
}

/**
 * Counts elements matching a selector in the DOM.
 */
export async function countElements(page: Page, selector: string): Promise<number> {
  return await page.locator(selector).count();
}

/**
 * Measures elements before and after scrolling to verify lazy loading.
 */
export async function measureLazyLoading(
  page: Page,
  elementSelector: string,
  scrollDistance: number = 2000
): Promise<{
  initialCount: number;
  afterScrollCount: number;
  lazyLoadingWorks: boolean;
}> {
  const initialCount = await countElements(page, elementSelector);

  // Scroll down
  await page.evaluate((distance) => {
    window.scrollBy(0, distance);
  }, scrollDistance);

  // Wait for lazy-loaded elements to render
  await page.waitForTimeout(1000);

  const afterScrollCount = await countElements(page, elementSelector);

  return {
    initialCount,
    afterScrollCount,
    lazyLoadingWorks: afterScrollCount > initialCount,
  };
}

/**
 * Creates a performance metric object with threshold checking.
 */
export function createMetric(
  name: string,
  value: number,
  unit: string,
  threshold?: number
): PerfMetric {
  const metric: PerfMetric = { name, value, unit };
  if (threshold !== undefined) {
    metric.threshold = threshold;
    metric.passed = value <= threshold;
  }
  return metric;
}

/**
 * Creates a boolean metric (pass/fail).
 */
export function createBooleanMetric(
  name: string,
  passed: boolean
): PerfMetric {
  return {
    name,
    value: passed ? 1 : 0,
    unit: 'boolean',
    passed,
  };
}

/**
 * Saves performance results to a JSON file.
 */
export function saveMetrics(metrics: PerfMetric[], outputPath: string): PerfResults {
  const results: PerfResults = {
    timestamp: new Date().toISOString(),
    commit: process.env.BUILDKITE_COMMIT || process.env.GITHUB_SHA || 'local',
    metrics,
    summary: {
      total: metrics.length,
      passed: metrics.filter(m => m.passed !== false).length,
      failed: metrics.filter(m => m.passed === false).length,
    },
  };

  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(outputPath, JSON.stringify(results, null, 2));
  return results;
}

/**
 * Formats metrics as a markdown table for CI reporting.
 */
export function formatMarkdownSummary(results: PerfResults): string {
  const lines = [
    '## Performance Test Results',
    '',
    `**Commit:** ${results.commit}`,
    `**Timestamp:** ${results.timestamp}`,
    '',
    '| Metric | Value | Threshold | Status |',
    '|--------|-------|-----------|--------|',
  ];

  for (const metric of results.metrics) {
    const value = metric.unit === 'boolean'
      ? (metric.value === 1 ? 'true' : 'false')
      : `${metric.value.toFixed(0)}${metric.unit}`;

    const threshold = metric.threshold !== undefined
      ? `${metric.threshold}${metric.unit}`
      : '-';

    const status = metric.passed === undefined
      ? '-'
      : metric.passed ? '✅' : '❌';

    lines.push(`| ${metric.name} | ${value} | ${threshold} | ${status} |`);
  }

  lines.push('');
  lines.push(`**Summary:** ${results.summary.passed}/${results.summary.total} passed`);

  if (results.summary.failed > 0) {
    lines.push(`**⚠️ ${results.summary.failed} metric(s) exceeded threshold**`);
  }

  return lines.join('\n');
}

/**
 * Performance thresholds for various metrics.
 */
export const PERF_THRESHOLDS = {
  // Note: CI environments are slower than local dev, thresholds set accordingly
  SINGLE_RUN_LOAD_MS: 10000, // Includes navigation + click + chart render (bumped for CI variability)
  COMPARISON_LOAD_MS: 10000, // Multiple runs with charts (bumped for CI variability)
  CHART_RENDER_MS: 500,
  LCP_MS: 2500,
  CHARTS_IN_DOM_INITIAL: 10,
  BACKEND_SAMPLE_SIZE: 2000,
};
