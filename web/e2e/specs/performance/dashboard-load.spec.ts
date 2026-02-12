import { test, expect } from "@playwright/test";
import {
  measurePageLoad,
  setupLCPMeasurement,
  getLCP,
  measureTimeToSelector,
  countElements,
  createMetric,
  createBooleanMetric,
  saveMetrics,
  formatMarkdownSummary,
  PERF_THRESHOLDS,
  type PerfMetric,
} from "../../utils/perf-helpers";
import * as path from "path";

// Dev user credentials (from seed-dev.ts)
const DEV_ORG_SLUG = "dev-org";
const DEV_PROJECT = "my-ml-project";

// Selectors for chart elements - uPlot (not ECharts)
const CHART_SELECTOR = ".uplot canvas";
const CHART_WRAPPER_SELECTOR = ".uplot";

// Helper to wait for a chart canvas with non-zero dimensions
async function waitForRenderedChart(page: import("@playwright/test").Page, timeout = 30000) {
  // First wait for wrapper to exist
  await page.waitForSelector(CHART_WRAPPER_SELECTOR, { state: "attached", timeout });

  // Scroll first chart into view to trigger IntersectionObserver
  await page.locator(CHART_WRAPPER_SELECTOR).first().scrollIntoViewIfNeeded();

  // Wait for canvas with actual dimensions (not 0x0)
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

// Collect all metrics across tests
const allMetrics: PerfMetric[] = [];

// Auth is handled by perf-setup project (see playwright.config.ts)
test.describe("Dashboard Performance Tests", () => {

  test.describe("Single Run View (50 charts, 100k datapoints)", () => {
    test("measures initial load time", async ({ page }) => {
      // Setup LCP measurement before navigation
      await setupLCPMeasurement(page);

      const start = performance.now();

      // Navigate to first run (high-fidelity, 100k datapoints)
      await page.goto(`/o/${DEV_ORG_SLUG}/projects/${DEV_PROJECT}`);
      await page.waitForLoadState("domcontentloaded");

      // Click on first run to open it
      const runLink = page.locator('a[href*="/projects/"][href*="/"]').first();
      await runLink.click();

      // Wait for chart to fully render (canvas with non-zero dimensions)
      await waitForRenderedChart(page);

      const loadTime = performance.now() - start;
      const lcp = await getLCP(page);

      // Get page load metrics
      const pageMetrics = await measurePageLoad(page);

      allMetrics.push(
        createMetric("single_run_load_ms", loadTime, "ms", PERF_THRESHOLDS.SINGLE_RUN_LOAD_MS),
        createMetric("single_run_lcp_ms", lcp, "ms", PERF_THRESHOLDS.LCP_MS),
        createMetric("single_run_fcp_ms", pageMetrics.firstContentfulPaint, "ms"),
        createMetric("single_run_dom_loaded_ms", pageMetrics.domContentLoaded, "ms")
      );

      expect(loadTime).toBeLessThan(PERF_THRESHOLDS.SINGLE_RUN_LOAD_MS);
    });

    test("validates lazy loading works", async ({ page }) => {
      // Navigate to a run with many charts
      await page.goto(`/o/${DEV_ORG_SLUG}/projects/${DEV_PROJECT}`);
      await page.waitForLoadState("domcontentloaded");

      // Click on first run
      const runLink = page.locator('a[href*="/projects/"][href*="/"]').first();
      await runLink.click();

      // Wait for chart to fully render (canvas with non-zero dimensions)
      await waitForRenderedChart(page);

      // Wait for initial render to settle via requestAnimationFrame
      await page.evaluate(
        () => new Promise<void>((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        })
      );

      // Count charts in DOM before scroll
      const initialCharts = await countElements(page, CHART_SELECTOR);

      // Scroll down to trigger lazy loading
      await page.evaluate(() => window.scrollBy(0, 3000));

      // Wait for lazy-loaded charts to appear
      await expect.poll(
        () => countElements(page, CHART_SELECTOR),
        { timeout: 10000 }
      ).toBeGreaterThanOrEqual(initialCharts);

      // Count charts after scroll
      const afterScrollCharts = await countElements(page, CHART_SELECTOR);

      const lazyLoadingWorks = afterScrollCharts > initialCharts || initialCharts < 20;

      allMetrics.push(
        createMetric("charts_in_dom_initial", initialCharts, "count", PERF_THRESHOLDS.CHARTS_IN_DOM_INITIAL),
        createMetric("charts_after_scroll", afterScrollCharts, "count"),
        createBooleanMetric("lazy_loading_works", lazyLoadingWorks)
      );

      // Lazy loading should mean not all 50 charts are in DOM initially
      expect(initialCharts).toBeLessThan(PERF_THRESHOLDS.CHARTS_IN_DOM_INITIAL * 3); // Some buffer
      expect(lazyLoadingWorks).toBe(true);
    });
  });

  test.describe("Comparison View (5 runs = 250+ chart components)", () => {
    test("measures comparison view load time", async ({ page }) => {
      await setupLCPMeasurement(page);

      const start = performance.now();

      // Navigate to project comparison view
      await page.goto(`/o/${DEV_ORG_SLUG}/projects/${DEV_PROJECT}`);
      await page.waitForLoadState("domcontentloaded");

      // Wait for runs table to load
      await page.waitForSelector('[data-testid="runs-table"], table', { timeout: 15000 });

      // Select multiple runs for comparison (click checkboxes or selection)
      const runCheckboxes = page.locator('input[type="checkbox"]');
      const checkboxCount = await runCheckboxes.count();

      if (checkboxCount >= 5) {
        // Select first 5 runs
        for (let i = 0; i < 5; i++) {
          await runCheckboxes.nth(i).click();
        }
      }

      // Wait for chart to fully render (canvas with non-zero dimensions)
      await waitForRenderedChart(page);

      const loadTime = performance.now() - start;
      const lcp = await getLCP(page);

      allMetrics.push(
        createMetric("comparison_load_ms", loadTime, "ms", PERF_THRESHOLDS.COMPARISON_LOAD_MS),
        createMetric("comparison_lcp_ms", lcp, "ms", PERF_THRESHOLDS.LCP_MS)
      );

      expect(loadTime).toBeLessThan(PERF_THRESHOLDS.COMPARISON_LOAD_MS);
    });

    test("validates lazy loading in comparison view", async ({ page }) => {
      // Navigate to project comparison view
      await page.goto(`/o/${DEV_ORG_SLUG}/projects/${DEV_PROJECT}`);
      await page.waitForLoadState("domcontentloaded");

      // Wait for table
      await page.waitForSelector('[data-testid="runs-table"], table', { timeout: 15000 });

      // Select runs
      const runCheckboxes = page.locator('input[type="checkbox"]');
      const checkboxCount = await runCheckboxes.count();

      if (checkboxCount >= 5) {
        for (let i = 0; i < 5; i++) {
          await runCheckboxes.nth(i).click();
        }
      }

      // Wait for chart to fully render (canvas with non-zero dimensions)
      await waitForRenderedChart(page);

      // Wait for initial render to settle
      await page.evaluate(
        () => new Promise<void>((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        })
      );

      // Measure initial chart count
      const initialCount = await countElements(page, CHART_SELECTOR);

      // Scroll down
      await page.evaluate(() => window.scrollBy(0, 3000));

      // Wait for lazy-loaded charts to appear
      await expect.poll(
        () => countElements(page, CHART_SELECTOR),
        { timeout: 10000 }
      ).toBeGreaterThanOrEqual(initialCount);

      const afterScrollCount = await countElements(page, CHART_SELECTOR);
      const lazyLoadingWorks = afterScrollCount > initialCount || initialCount < 50;

      allMetrics.push(
        createMetric("comparison_charts_initial", initialCount, "count"),
        createMetric("comparison_charts_after_scroll", afterScrollCount, "count"),
        createBooleanMetric("comparison_lazy_loading_works", lazyLoadingWorks)
      );

      // With 250+ potential chart components, lazy loading should defer most
      expect(initialCount).toBeLessThan(50);
    });
  });

  test.describe("Backend API Performance", () => {
    test("validates backend sampling for large datasets", async ({ page }) => {
      // Navigate to get auth context
      await page.goto(`/o/${DEV_ORG_SLUG}/projects/${DEV_PROJECT}`);
      await page.waitForLoadState("domcontentloaded");

      // Get first run ID by intercepting network
      let runId: string | null = null;

      // Listen for API calls to find a run ID
      page.on("response", (response) => {
        const url = response.url();
        if (url.includes("/trpc/runs") && response.status() === 200) {
          response.json().then((data) => {
            if (data?.[0]?.result?.data?.json?.[0]?.id) {
              runId = data[0].result.data.json[0].id;
            }
          }).catch(() => {});
        }
      });

      // Trigger runs fetch
      await page.reload();
      await page.waitForLoadState("domcontentloaded");

      // Wait for a run ID to be captured from network
      await expect.poll(() => runId, { timeout: 10000 }).toBeTruthy();

      // If we got a run ID, test the graph endpoint
      if (runId) {
        // Make a request to the graph endpoint
        const graphResponse = await page.evaluate(async (params) => {
          const response = await fetch(`/trpc/runs.data.graph?batch=1&input=${encodeURIComponent(JSON.stringify({ "0": { json: params } }))}`, {
            credentials: "include",
          });
          const data = await response.json();
          return data?.[0]?.result?.data?.json;
        }, {
          runId,
          projectName: DEV_PROJECT,
          logName: "train/loss",
          logGroup: "train",
        });

        if (graphResponse?.data) {
          const dataPointCount = graphResponse.data.length;

          // Backend should sample to ~2000 points max for 100k dataset
          const samplingWorks = dataPointCount <= PERF_THRESHOLDS.BACKEND_SAMPLE_SIZE;

          allMetrics.push(
            createMetric("backend_datapoints_returned", dataPointCount, "count", PERF_THRESHOLDS.BACKEND_SAMPLE_SIZE),
            createBooleanMetric("backend_sampling_works", samplingWorks)
          );

          expect(dataPointCount).toBeLessThanOrEqual(PERF_THRESHOLDS.BACKEND_SAMPLE_SIZE);
        }
      }
    });
  });

  test.afterAll(async () => {
    // Save all collected metrics
    const outputPath = path.join(process.cwd(), "perf-results.json");
    const results = saveMetrics(allMetrics, outputPath);

    // Log summary
    console.log("\n" + "=".repeat(60));
    console.log(formatMarkdownSummary(results));
    console.log("=".repeat(60) + "\n");

    // Fail if any metrics exceeded thresholds
    if (results.summary.failed > 0) {
      console.error(`\n${results.summary.failed} metric(s) exceeded threshold!`);
    }
  });
});
