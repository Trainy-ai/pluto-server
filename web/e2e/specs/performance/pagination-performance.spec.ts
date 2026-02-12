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

// Pagination performance thresholds
// Note: With 170 runs and many chart groups, pagination triggers expensive re-renders
const PAGINATION_THRESHOLDS = {
  // Maximum time for pagination to complete (catch hangs)
  MAX_PAGINATION_MS: 5000,
  // Maximum time for initial table load
  MAX_TABLE_LOAD_MS: 10000,
};

// Collect metrics
const allMetrics: PerfMetric[] = [];

test.describe("Pagination Performance Tests", () => {
  test.describe("Table Pagination Performance", () => {
    test("table loads within threshold", async ({ page }) => {
      // Navigate to project runs page
      await page.goto(`/o/${DEV_ORG_SLUG}/projects/${DEV_PROJECT}`);

      // Wait for table to load
      const tableLoadStart = performance.now();
      await page.waitForSelector("table", { timeout: PAGINATION_THRESHOLDS.MAX_TABLE_LOAD_MS });

      // Wait for at least one row to be visible
      await page.waitForSelector("table tbody tr", { timeout: PAGINATION_THRESHOLDS.MAX_TABLE_LOAD_MS });
      const tableLoadTime = performance.now() - tableLoadStart;

      console.log(`\n=== Table Load Performance Test ===`);
      console.log(`Table load time: ${tableLoadTime.toFixed(0)}ms`);
      console.log(`Threshold: ${PAGINATION_THRESHOLDS.MAX_TABLE_LOAD_MS}ms`);

      // Collect metrics
      allMetrics.push(
        createMetric(
          "table_load_ms",
          tableLoadTime,
          "ms",
          PAGINATION_THRESHOLDS.MAX_TABLE_LOAD_MS
        )
      );

      // Assert table loads within threshold
      expect(tableLoadTime).toBeLessThan(PAGINATION_THRESHOLDS.MAX_TABLE_LOAD_MS);
    });

    test("pagination controls respond without hanging", async ({ page }) => {
      // Navigate to project runs page
      await page.goto(`/o/${DEV_ORG_SLUG}/projects/${DEV_PROJECT}`);
      await page.waitForLoadState("domcontentloaded");

      // Wait for table
      await page.waitForSelector("table tbody tr", { timeout: PAGINATION_THRESHOLDS.MAX_TABLE_LOAD_MS });

      // Find pagination buttons
      const nextButton = page.locator('button[aria-label="Go to next page"], button:has(svg.lucide-chevron-right)').first();

      // Check if next button exists
      const hasNextButton = await nextButton.count() > 0;
      if (!hasNextButton) {
        console.log("No pagination controls found");
        test.skip();
        return;
      }

      // Even if disabled, clicking should not hang the UI
      const clickStart = performance.now();

      // Try to click (may be disabled, that's OK)
      try {
        await nextButton.click({ timeout: PAGINATION_THRESHOLDS.MAX_PAGINATION_MS });
      } catch {
        // Button might be disabled, that's fine
      }

      // The key assertion: UI should still be responsive
      // Try to interact with the page to verify it's not frozen
      await page.waitForTimeout(100);

      // Verify page is responsive by checking we can still query elements
      const rowCount = await page.locator("table tbody tr").count();
      const clickTime = performance.now() - clickStart;

      console.log(`\n=== Pagination Control Test ===`);
      console.log(`Click + verify time: ${clickTime.toFixed(0)}ms`);
      console.log(`Table rows visible: ${rowCount}`);

      // Assert the UI didn't hang
      expect(clickTime).toBeLessThan(PAGINATION_THRESHOLDS.MAX_PAGINATION_MS);
      expect(rowCount).toBeGreaterThan(0);
    });

    test("multiple rapid paginations do not cause hang", async ({ page }) => {
      // Navigate to project runs page
      await page.goto(`/o/${DEV_ORG_SLUG}/projects/${DEV_PROJECT}`);
      await page.waitForLoadState("domcontentloaded");

      // Wait for table
      await page.waitForSelector("table tbody tr", { timeout: PAGINATION_THRESHOLDS.MAX_TABLE_LOAD_MS });

      // Find next button
      const nextButton = page.locator('button[aria-label="Go to next page"], button:has(svg.lucide-chevron-right)').first();

      // Check if pagination is available
      const isNextDisabled = await nextButton.isDisabled().catch(() => true);
      if (isNextDisabled) {
        console.log("Pagination not available (single page of results)");
        test.skip();
        return;
      }

      console.log(`\n=== Rapid Pagination Test ===`);

      // Perform multiple rapid paginations
      const startTime = performance.now();
      const paginationCount = 3;

      for (let i = 0; i < paginationCount; i++) {
        const isDisabled = await nextButton.isDisabled().catch(() => true);
        if (isDisabled) {
          console.log(`Stopped at page ${i + 1} (no more pages)`);
          break;
        }

        await nextButton.click();
        // Small delay to let the UI update
        await page.waitForTimeout(100);
      }

      // Wait for final state to settle
      await page.waitForLoadState("domcontentloaded");

      const totalTime = performance.now() - startTime;
      const avgTimePerPagination = totalTime / paginationCount;

      console.log(`Total time for ${paginationCount} paginations: ${totalTime.toFixed(0)}ms`);
      console.log(`Average per pagination: ${avgTimePerPagination.toFixed(0)}ms`);

      // Collect metrics
      allMetrics.push(
        createMetric(
          "rapid_pagination_total_ms",
          totalTime,
          "ms",
          PAGINATION_THRESHOLDS.MAX_PAGINATION_MS * paginationCount
        ),
        createMetric(
          "rapid_pagination_avg_ms",
          avgTimePerPagination,
          "ms",
          PAGINATION_THRESHOLDS.MAX_PAGINATION_MS
        )
      );

      // Assert total time is reasonable (not hanging)
      expect(totalTime).toBeLessThan(PAGINATION_THRESHOLDS.MAX_PAGINATION_MS * paginationCount);
    });
  });

  // Save metrics after all tests
  test.afterAll(async () => {
    if (allMetrics.length > 0) {
      const outputPath = path.join(process.cwd(), "pagination-perf-results.json");
      const results = saveMetrics(allMetrics, outputPath);

      console.log("\n" + formatMarkdownSummary(results));
      console.log(`\nResults saved to: ${outputPath}`);
    }
  });
});
