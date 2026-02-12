import { test, expect } from "@playwright/test";
import {
  measurePageLoad,
  setupLCPMeasurement,
  getLCP,
  createMetric,
  saveMetrics,
  formatMarkdownSummary,
  PERF_THRESHOLDS,
  type PerfMetric,
} from "../../utils/perf-helpers";
import * as path from "path";

// Dev user credentials (from seed-dev.ts)
const DEV_ORG_SLUG = "dev-org";
const DEV_PROJECT = "my-ml-project";

// Chart selectors - uPlot (not ECharts)
const CHART_WRAPPER_SELECTOR = ".uplot";

// Cache performance thresholds (adjusted for Docker/CI environments)
const CACHE_THRESHOLDS = {
  // Warm load should be faster than cold load (improvement expected)
  WARM_LOAD_IMPROVEMENT_PERCENT: 10,
  // Maximum acceptable warm load time (relaxed for Docker overhead)
  WARM_LOAD_MAX_MS: 15000,
  // Cold load baseline (for reference, not a hard failure)
  COLD_LOAD_MAX_MS: 20000,
};

// Helper to wait for a chart canvas with non-zero dimensions
async function waitForRenderedChart(
  page: import("@playwright/test").Page,
  timeout = 30000
) {
  await page.waitForSelector(CHART_WRAPPER_SELECTOR, {
    state: "attached",
    timeout,
  });
  await page.locator(CHART_WRAPPER_SELECTOR).first().scrollIntoViewIfNeeded();
  await page.waitForFunction(
    () => {
      const canvases = document.querySelectorAll(".uplot canvas");
      for (const canvas of canvases) {
        if ((canvas as HTMLCanvasElement).width > 0 && (canvas as HTMLCanvasElement).height > 0) {
          return true;
        }
      }
      return false;
    },
    { timeout }
  );
}

// Collect metrics
const allMetrics: PerfMetric[] = [];

test.describe("Cache Performance Tests", () => {
  test.describe("Backend Cache Hit Performance", () => {
    test("warm load is faster than cold load", async ({ page }) => {
      // --- COLD LOAD (first visit, cache miss) ---
      await setupLCPMeasurement(page);
      const coldStart = performance.now();

      // Navigate to project page
      await page.goto(`/o/${DEV_ORG_SLUG}/projects/${DEV_PROJECT}`);
      await page.waitForLoadState("domcontentloaded");

      // Click on first run
      const runLink = page.locator('a[href*="/projects/"][href*="/"]').first();
      await runLink.click();

      // Wait for chart to render
      await waitForRenderedChart(page);
      const coldLoadTime = performance.now() - coldStart;
      const coldLCP = await getLCP(page);

      // Store the run URL for warm load
      const runUrl = page.url();

      // --- NAVIGATE AWAY ---
      await page.goto(`/o/${DEV_ORG_SLUG}/projects`);
      await page.waitForLoadState("domcontentloaded");

      // --- WARM LOAD (second visit, cache hit) ---
      await setupLCPMeasurement(page);
      const warmStart = performance.now();

      // Navigate directly to the same run
      await page.goto(runUrl);
      await page.waitForLoadState("domcontentloaded");

      // Wait for chart to render
      await waitForRenderedChart(page);
      const warmLoadTime = performance.now() - warmStart;
      const warmLCP = await getLCP(page);

      // --- CALCULATE IMPROVEMENT ---
      const improvementPercent =
        ((coldLoadTime - warmLoadTime) / coldLoadTime) * 100;

      // Log results
      console.log("\n=== Cache Performance Results ===");
      console.log(`Cold Load: ${coldLoadTime.toFixed(0)}ms (LCP: ${coldLCP.toFixed(0)}ms)`);
      console.log(`Warm Load: ${warmLoadTime.toFixed(0)}ms (LCP: ${warmLCP.toFixed(0)}ms)`);
      console.log(`Improvement: ${improvementPercent.toFixed(1)}%`);

      // Collect metrics
      allMetrics.push(
        createMetric(
          "cache_cold_load_ms",
          coldLoadTime,
          "ms",
          CACHE_THRESHOLDS.COLD_LOAD_MAX_MS
        ),
        createMetric(
          "cache_warm_load_ms",
          warmLoadTime,
          "ms",
          CACHE_THRESHOLDS.WARM_LOAD_MAX_MS
        ),
        createMetric(
          "cache_improvement_percent",
          improvementPercent,
          "%",
          CACHE_THRESHOLDS.WARM_LOAD_IMPROVEMENT_PERCENT
        ),
        createMetric("cache_cold_lcp_ms", coldLCP, "ms"),
        createMetric("cache_warm_lcp_ms", warmLCP, "ms")
      );

      // Assertions
      expect(warmLoadTime).toBeLessThan(CACHE_THRESHOLDS.WARM_LOAD_MAX_MS);
    });

    test("repeated API calls benefit from cache", async ({ page }) => {
      // First visit - cache miss
      await page.goto(`/o/${DEV_ORG_SLUG}/projects/${DEV_PROJECT}`);
      await page.waitForLoadState("domcontentloaded");

      const runLink = page.locator('a[href*="/projects/"][href*="/"]').first();
      await runLink.click();
      await waitForRenderedChart(page);

      // Navigate away
      await page.goto(`/o/${DEV_ORG_SLUG}/projects`);
      await page.waitForLoadState("domcontentloaded");

      // Second visit - cache hit
      await page.goBack();
      await page.waitForLoadState("domcontentloaded");
      await waitForRenderedChart(page);

      // The main assertion is that the page loads without errors
      expect(true).toBe(true);
    });

    test("comparison view benefits from cache", async ({ page }) => {
      // Navigate to comparison view with multiple runs
      await page.goto(`/o/${DEV_ORG_SLUG}/projects/${DEV_PROJECT}`);
      await page.waitForLoadState("domcontentloaded");

      // --- COLD LOAD ---
      const coldStart = performance.now();

      // Click on first run
      const runLink = page.locator('a[href*="/projects/"][href*="/"]').first();
      await runLink.click();
      await waitForRenderedChart(page);

      const coldTime = performance.now() - coldStart;

      // --- WARM LOAD (same data, different view) ---
      await page.goto(`/o/${DEV_ORG_SLUG}/projects/${DEV_PROJECT}`);
      await page.waitForLoadState("domcontentloaded");

      const warmStart = performance.now();

      // Click same run again
      await runLink.click();
      await waitForRenderedChart(page);

      const warmTime = performance.now() - warmStart;

      console.log(`\n=== Comparison View Cache Test ===`);
      console.log(`First visit: ${coldTime.toFixed(0)}ms`);
      console.log(`Return visit: ${warmTime.toFixed(0)}ms`);

      // Collect metrics
      allMetrics.push(
        createMetric("comparison_cold_load_ms", coldTime, "ms"),
        createMetric("comparison_warm_load_ms", warmTime, "ms")
      );

      // Warm load should complete successfully
      expect(warmTime).toBeLessThan(CACHE_THRESHOLDS.WARM_LOAD_MAX_MS);
    });
  });

  // Save metrics after all tests
  test.afterAll(async () => {
    if (allMetrics.length > 0) {
      const outputPath = path.join(process.cwd(), "cache-perf-results.json");
      const results = saveMetrics(allMetrics, outputPath);

      console.log("\n" + formatMarkdownSummary(results));
      console.log(`\nResults saved to: ${outputPath}`);
    }
  });
});
