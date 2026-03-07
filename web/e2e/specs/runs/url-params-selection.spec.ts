import { test, expect } from "@playwright/test";
import { TEST_ORG, TEST_PROJECT } from "../../fixtures/test-data";
import { waitForRunsData } from "../../utils/test-helpers";

/**
 * Tests for URL parameter-based run selection in the run comparison view.
 *
 * Implementation requirements for these tests to pass:
 * 1. Add `data-run-id={run.id}` attribute to TableRow in data-table.tsx
 * 2. Add `runs` param to validateSearch in the route file
 * 3. Update useSelectedRuns to initialize from URL params
 * 4. Sync URL when selection changes
 */
test.describe("Run Comparison URL Parameters", () => {
  const orgSlug = TEST_ORG.slug;
  const projectName = TEST_PROJECT.name;

  /**
   * Clear IndexedDB cache to ensure URL params take priority over cached selection.
   * Uses addInitScript so the deletion runs before app JS on the next navigation,
   * avoiding the "onblocked" issue when the app holds an open IDB connection.
   */
  async function clearSelectionCache(page: import("@playwright/test").Page) {
    await page.addInitScript(() => {
      indexedDB.deleteDatabase("run-selection-db");
    });
  }

  /**
   * Assert that exactly `expectedCount` runs are selected by extracting
   * the number from "X of Y runs selected" text. Avoids false-positive
   * substring matches (e.g., "1" matching in "164").
   */
  async function expectSelectionCount(
    page: import("@playwright/test").Page,
    expectedCount: number,
    timeout = 15000
  ) {
    const selectionContainer = page.locator("text=runs selected").locator("..");
    await expect
      .poll(
        async () => {
          const text = await selectionContainer.textContent();
          const match = text?.match(/(\d+)\s+of\s+\d+/);
          return match ? parseInt(match[1]) : -1;
        },
        { timeout, message: `Waiting for ${expectedCount} runs to be selected` }
      )
      .toBe(expectedCount);
  }

  /**
   * Helper to get run IDs from the table.
   * Requires data-run-id attribute on table rows.
   */
  async function getRunIdsFromTable(page: import("@playwright/test").Page, count: number = 5) {
    const runRows = page.locator('[data-run-id]');
    const actualCount = await runRows.count();
    const idsToGet = Math.min(count, actualCount);

    const runIds: string[] = [];
    for (let i = 0; i < idsToGet; i++) {
      const id = await runRows.nth(i).getAttribute('data-run-id');
      if (id) runIds.push(id);
    }
    return runIds;
  }

  test.describe("Pre-selecting runs via URL", () => {
    test("navigating with ?runs= param pre-selects specified runs", async ({ page }) => {
      // First, navigate to the project page to get run IDs
      await page.goto(`/o/${orgSlug}/projects/${projectName}`);
      await waitForRunsData(page);
      await page.waitForLoadState("domcontentloaded");

      // Get run IDs from table (requires data-run-id attribute on rows)
      const runIds = await getRunIdsFromTable(page, 2);

      if (runIds.length < 2) {
        test.skip();
        return;
      }

      // Clear the selection cache before testing URL params
      // This ensures URL params aren't overridden by cached selection from first visit
      await clearSelectionCache(page);

      // Now navigate with the runs URL parameter
      await page.goto(`/o/${orgSlug}/projects/${projectName}?runs=${runIds[0]},${runIds[1]}`);
      await waitForRunsData(page);
      await page.waitForLoadState("domcontentloaded");

      // Verify the selection counter shows exactly 2 runs selected
      await expectSelectionCount(page, 2);
    });

    test("?runs= param with single run ID selects that run", async ({ page }) => {
      // First, get a run ID
      await page.goto(`/o/${orgSlug}/projects/${projectName}`);
      await waitForRunsData(page);
      await page.waitForLoadState("domcontentloaded");

      const runIds = await getRunIdsFromTable(page, 1);

      if (runIds.length < 1) {
        test.skip();
        return;
      }

      // Clear cache to ensure URL params take priority
      await clearSelectionCache(page);

      // Navigate with single run in URL
      await page.goto(`/o/${orgSlug}/projects/${projectName}?runs=${runIds[0]}`);
      await waitForRunsData(page);
      await page.waitForLoadState("domcontentloaded");

      // Verify exactly 1 run is selected
      await expectSelectionCount(page, 1);
    });

    test("invalid run IDs in ?runs= param are gracefully ignored", async ({ page }) => {
      // First, get a valid run ID
      await page.goto(`/o/${orgSlug}/projects/${projectName}`);
      await waitForRunsData(page);
      await page.waitForLoadState("domcontentloaded");

      const runIds = await getRunIdsFromTable(page, 1);

      if (runIds.length < 1) {
        test.skip();
        return;
      }

      // Clear cache to ensure URL params take priority
      await clearSelectionCache(page);

      // Navigate with one valid and one invalid run ID
      await page.goto(`/o/${orgSlug}/projects/${projectName}?runs=${runIds[0]},nonexistent-run-id-12345`);
      await waitForRunsData(page);
      await page.waitForLoadState("domcontentloaded");

      // Should only select the valid run (1 selected)
      await expectSelectionCount(page, 1);
    });

    test("empty ?runs= param falls back to default selection", async ({ page }) => {
      // Navigate with empty runs param
      await page.goto(`/o/${orgSlug}/projects/${projectName}?runs=`);
      await waitForRunsData(page);
      await page.waitForLoadState("domcontentloaded");

      // Should fall back to default (first 5 runs selected)
      const selectionContainer = page.locator('text=runs selected').locator('..');
      // Default behavior selects up to 5 runs
      await expect(selectionContainer).toBeVisible({ timeout: 5000 });

      // The count should be > 0 (default selection) — use polling to wait for data
      await expect
        .poll(
          async () => {
            const text = await selectionContainer.textContent();
            const match = text?.match(/(\d+)\s*of/);
            return match ? parseInt(match[1]) : 0;
          },
          { timeout: 10000, message: "Waiting for default selection count > 0" }
        )
        .toBeGreaterThan(0);
    });
  });

  test.describe("URL updates on selection change", () => {
    test("selecting a run updates the URL with runs param", async ({ page }) => {
      // Start fresh without runs param
      await page.goto(`/o/${orgSlug}/projects/${projectName}`);
      await waitForRunsData(page);
      await page.waitForLoadState("domcontentloaded");

      // Deselect all first
      const visibilityButton = page.locator('button[aria-label="Visibility options"]').first();
      if ((await visibilityButton.count()) === 0) {
        test.skip();
        return;
      }

      await visibilityButton.click();
      await page.locator('button:has-text("Deselect all")').click();
      await page.keyboard.press("Escape");

      // Get run IDs from table
      const runIds = await getRunIdsFromTable(page, 1);

      if (runIds.length < 1) {
        test.skip();
        return;
      }

      // Select the first run via toggle button
      const toggleButtons = page.locator('button[aria-label="Toggle select row"]');
      await toggleButtons.first().click();

      // Wait for URL to update (debounced)
      await expect.poll(() => page.url(), { timeout: 5000 }).toContain('runs=');

      // Verify URL contains the runs param
      const url = page.url();
      expect(url).toContain('runs=');
      expect(url).toContain(runIds[0]);
    });

    test("deselecting all runs removes runs param from URL", async ({ page }) => {
      // First, get a run ID and navigate with it selected
      await page.goto(`/o/${orgSlug}/projects/${projectName}`);
      await waitForRunsData(page);
      await page.waitForLoadState("domcontentloaded");

      const runIds = await getRunIdsFromTable(page, 1);

      if (runIds.length < 1) {
        test.skip();
        return;
      }

      // Navigate with run selected
      await page.goto(`/o/${orgSlug}/projects/${projectName}?runs=${runIds[0]}`);
      await waitForRunsData(page);
      await page.waitForLoadState("domcontentloaded");

      // Deselect all
      const visibilityButton = page.locator('button[aria-label="Visibility options"]').first();
      await visibilityButton.click();
      await page.locator('button:has-text("Deselect all")').click();
      await page.keyboard.press("Escape");

      // Wait for URL to update (debounced) - runs param should be removed
      await expect.poll(() => page.url(), { timeout: 5000 }).not.toMatch(/runs=[^&]+/);
    });
  });

  test.describe("URL params combined with other params", () => {
    test("?runs= works together with ?chart= param", async ({ page }) => {
      // Get a run ID first
      await page.goto(`/o/${orgSlug}/projects/${projectName}`);
      await waitForRunsData(page);
      await page.waitForLoadState("domcontentloaded");

      const runIds = await getRunIdsFromTable(page, 1);

      if (runIds.length < 1) {
        test.skip();
        return;
      }

      // Clear cache to ensure URL params take priority
      await clearSelectionCache(page);

      // Navigate with both runs and chart params
      await page.goto(`/o/${orgSlug}/projects/${projectName}?runs=${runIds[0]}&chart=some-chart-id`);
      await waitForRunsData(page);
      await page.waitForLoadState("domcontentloaded");

      // Verify 1 run is selected (runs param works)
      await expectSelectionCount(page, 1);

      // Verify URL still has both params (use auto-retrying assertion — URL sync is debounced)
      await expect(page).toHaveURL(/runs=/, { timeout: 5000 });
      await expect(page).toHaveURL(/chart=/, { timeout: 5000 });
    });
  });

  test.describe("Shareable URLs", () => {
    test("copied URL with runs param can be shared and reproduced", async ({ page, browser }) => {
      // Get run IDs
      await page.goto(`/o/${orgSlug}/projects/${projectName}`);
      await waitForRunsData(page);
      await page.waitForLoadState("domcontentloaded");

      const runIds = await getRunIdsFromTable(page, 3);

      if (runIds.length < 3) {
        test.skip();
        return;
      }

      // Construct a shareable URL
      const shareableUrl = `/o/${orgSlug}/projects/${projectName}?runs=${runIds[0]},${runIds[1]},${runIds[2]}`;

      // Open in a NEW browser context with fresh IndexedDB to truly simulate sharing.
      // A new page in the same context shares IndexedDB, and the original page's
      // debounced cache writes can race with clearSelectionCache, causing stale state.
      const newContext = await browser.newContext({
        storageState: "e2e/.auth/user.json",
      });
      const newPage = await newContext.newPage();

      await newPage.goto(shareableUrl);
      await waitForRunsData(newPage);
      await newPage.waitForLoadState("domcontentloaded");

      // Verify exactly 3 runs are selected
      await expectSelectionCount(newPage, 3);

      await newContext.close();
    });
  });
});
