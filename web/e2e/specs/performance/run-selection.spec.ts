import { test, expect } from "@playwright/test";
import {
  createMetric,
  saveMetrics,
  formatMarkdownSummary,
  type PerfMetric,
} from "../../utils/perf-helpers";
import * as path from "path";

// Dev user credentials (from seed-dev.ts)
const DEV_ORG_SLUG = "dev-org";
const DEV_PROJECT = "my-ml-project";

// Performance thresholds for run selection interactions
// Note: With 170 runs and many chart groups, selection triggers expensive re-renders
const SELECTION_THRESHOLDS = {
  // INP (Interaction to Next Paint) thresholds
  SINGLE_SELECTION_INP_MS: 5000, // Single run toggle should respond within 5s
  RAPID_SELECTION_AVG_INP_MS: 5000, // Average for rapid selections
  HIGH_COUNT_SELECTION_INP_MS: 6000, // With many runs selected
};

// Selector for run toggle buttons (eye icon buttons)
const RUN_TOGGLE_SELECTOR = 'button[aria-label="Toggle select row"]';
const CHART_SELECTOR = ".uplot canvas";

// Collect all metrics across tests
const allMetrics: PerfMetric[] = [];

/**
 * Measures time from click to visual update using requestAnimationFrame.
 * More reliable than PerformanceObserver for some scenarios.
 */
async function measureClickToUpdate(
  page: import("@playwright/test").Page,
  selector: string,
  nthElement: number = 0
): Promise<number> {
  const start = await page.evaluate(() => performance.now());

  // Perform the click
  const element = page.locator(selector).nth(nthElement);
  await element.click();

  // Wait for the next frame after React updates
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => resolve());
        });
      })
  );

  const end = await page.evaluate(() => performance.now());
  return end - start;
}

// Auth is handled by perf-setup project (see playwright.config.ts)
test.describe("Run Selection Performance Tests", () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to project page with runs
    await page.goto(`/o/${DEV_ORG_SLUG}/projects/${DEV_PROJECT}`);
    await page.waitForLoadState("domcontentloaded");

    // Wait for runs table to load
    await page.waitForSelector(RUN_TOGGLE_SELECTOR, { timeout: 15000 });

    // Wait for initial charts to render
    await page.waitForSelector(CHART_SELECTOR, { timeout: 30000 });
  });

  test("measures single run selection INP", async ({ page }) => {
    // Find an unselected run (EyeOff icon)
    const unselectedRuns = page.locator(
      'button[aria-label="Toggle select row"]:has(svg.lucide-eye-off)'
    );
    const count = await unselectedRuns.count();

    if (count === 0) {
      // All runs selected, deselect one first
      await page.locator(RUN_TOGGLE_SELECTOR).first().click();
      await page.waitForTimeout(500);
    }

    // Measure selection click
    const selectionTime = await measureClickToUpdate(
      page,
      'button[aria-label="Toggle select row"]:has(svg.lucide-eye-off)',
      0
    );

    allMetrics.push(
      createMetric(
        "single_selection_click_ms",
        selectionTime,
        "ms",
        SELECTION_THRESHOLDS.SINGLE_SELECTION_INP_MS
      )
    );

    expect(selectionTime).toBeLessThan(
      SELECTION_THRESHOLDS.SINGLE_SELECTION_INP_MS
    );
  });

  test("measures deselection INP", async ({ page }) => {
    // Find a selected run (Eye icon)
    const selectedRuns = page.locator(
      'button[aria-label="Toggle select row"]:has(svg.lucide-eye:not(.lucide-eye-off))'
    );
    const count = await selectedRuns.count();

    if (count === 0) {
      // No runs selected, select one first
      await page.locator(RUN_TOGGLE_SELECTOR).first().click();
      await page.waitForTimeout(500);
    }

    // Measure deselection click
    const deselectionTime = await measureClickToUpdate(
      page,
      'button[aria-label="Toggle select row"]:has(svg.lucide-eye:not(.lucide-eye-off))',
      0
    );

    allMetrics.push(
      createMetric(
        "single_deselection_click_ms",
        deselectionTime,
        "ms",
        SELECTION_THRESHOLDS.SINGLE_SELECTION_INP_MS
      )
    );

    expect(deselectionTime).toBeLessThan(
      SELECTION_THRESHOLDS.SINGLE_SELECTION_INP_MS
    );
  });

  test("measures rapid selection sequence", async ({ page }) => {
    const toggleButtons = page.locator(RUN_TOGGLE_SELECTOR);
    const buttonCount = await toggleButtons.count();
    const clicksToMeasure = Math.min(5, buttonCount);

    const clickTimes: number[] = [];

    for (let i = 0; i < clicksToMeasure; i++) {
      const clickTime = await measureClickToUpdate(page, RUN_TOGGLE_SELECTOR, i);
      clickTimes.push(clickTime);

      // Small delay between clicks to let React settle
      await page.waitForTimeout(200);
    }

    const avgClickTime =
      clickTimes.reduce((a, b) => a + b, 0) / clickTimes.length;
    const maxClickTime = Math.max(...clickTimes);

    allMetrics.push(
      createMetric(
        "rapid_selection_avg_ms",
        avgClickTime,
        "ms",
        SELECTION_THRESHOLDS.RAPID_SELECTION_AVG_INP_MS
      ),
      createMetric("rapid_selection_max_ms", maxClickTime, "ms")
    );

    expect(avgClickTime).toBeLessThan(
      SELECTION_THRESHOLDS.RAPID_SELECTION_AVG_INP_MS
    );
  });

  test("measures selection with many runs already selected", async ({
    page,
  }) => {
    // First, select many runs to simulate high-count scenario
    const toggleButtons = page.locator(RUN_TOGGLE_SELECTOR);
    const buttonCount = await toggleButtons.count();

    // Select first 10 runs (or all available)
    const runsToSelect = Math.min(10, buttonCount);

    for (let i = 0; i < runsToSelect; i++) {
      const button = toggleButtons.nth(i);
      // Check if already selected
      const isSelected =
        (await button.locator("svg.lucide-eye:not(.lucide-eye-off)").count()) >
        0;
      if (!isSelected) {
        await button.click();
        await page.waitForTimeout(100);
      }
    }

    // Wait for charts to update after selecting runs
    await page.waitForTimeout(500);

    // Now measure toggling one more run
    const lastUnselected = page.locator(
      'button[aria-label="Toggle select row"]:has(svg.lucide-eye-off)'
    );
    const unselectedCount = await lastUnselected.count();

    if (unselectedCount > 0) {
      const highCountSelectionTime = await measureClickToUpdate(
        page,
        'button[aria-label="Toggle select row"]:has(svg.lucide-eye-off)',
        0
      );

      allMetrics.push(
        createMetric(
          "high_count_selection_ms",
          highCountSelectionTime,
          "ms",
          SELECTION_THRESHOLDS.HIGH_COUNT_SELECTION_INP_MS
        )
      );

      expect(highCountSelectionTime).toBeLessThan(
        SELECTION_THRESHOLDS.HIGH_COUNT_SELECTION_INP_MS
      );
    }
  });

  test.afterAll(async () => {
    // Save all collected metrics
    const outputPath = path.join(process.cwd(), "perf-results-selection.json");
    const results = saveMetrics(allMetrics, outputPath);

    // Log summary
    console.log("\n" + "=".repeat(60));
    console.log("RUN SELECTION PERFORMANCE RESULTS");
    console.log(formatMarkdownSummary(results));
    console.log("=".repeat(60) + "\n");

    // Fail if any metrics exceeded thresholds
    if (results.summary.failed > 0) {
      console.error(`\n${results.summary.failed} metric(s) exceeded threshold!`);
    }
  });
});
