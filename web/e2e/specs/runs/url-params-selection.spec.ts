import { test, expect } from "@playwright/test";
import { TEST_ORG, TEST_PROJECT } from "../../fixtures/test-data";
import { waitForTRPC } from "../../utils/test-helpers";

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
   * The useSelectedRuns hook caches selection state in IndexedDB, which can
   * interfere with URL param tests if not cleared.
   */
  async function clearSelectionCache(page: import("@playwright/test").Page) {
    await page.evaluate(() => {
      return new Promise<void>((resolve) => {
        const deleteRequest = indexedDB.deleteDatabase("run-selection-db");
        deleteRequest.onsuccess = () => resolve();
        deleteRequest.onerror = () => resolve();
        deleteRequest.onblocked = () => resolve();
      });
    });
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
      await waitForTRPC(page);
      await page.waitForLoadState("networkidle");

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
      await waitForTRPC(page);
      await page.waitForLoadState("networkidle");

      // Verify the selection counter shows exactly 2 runs selected
      // Use toPass() for resilience against selection state propagation delays
      const selectionContainer = page.locator('text=runs selected').locator('..');
      await expect(async () => {
        await expect(selectionContainer).toContainText("2", { timeout: 2000 });
      }).toPass({ timeout: 10000 });
    });

    test("?runs= param with single run ID selects that run", async ({ page }) => {
      // First, get a run ID
      await page.goto(`/o/${orgSlug}/projects/${projectName}`);
      await waitForTRPC(page);
      await page.waitForLoadState("networkidle");

      const runIds = await getRunIdsFromTable(page, 1);

      if (runIds.length < 1) {
        test.skip();
        return;
      }

      // Clear cache to ensure URL params take priority
      await clearSelectionCache(page);

      // Navigate with single run in URL
      await page.goto(`/o/${orgSlug}/projects/${projectName}?runs=${runIds[0]}`);
      await waitForTRPC(page);
      await page.waitForLoadState("networkidle");

      // Verify exactly 1 run is selected
      const selectionContainer = page.locator('text=runs selected').locator('..');
      await expect(async () => {
        await expect(selectionContainer).toContainText("1", { timeout: 2000 });
      }).toPass({ timeout: 10000 });
    });

    test("invalid run IDs in ?runs= param are gracefully ignored", async ({ page }) => {
      // First, get a valid run ID
      await page.goto(`/o/${orgSlug}/projects/${projectName}`);
      await waitForTRPC(page);
      await page.waitForLoadState("networkidle");

      const runIds = await getRunIdsFromTable(page, 1);

      if (runIds.length < 1) {
        test.skip();
        return;
      }

      // Clear cache to ensure URL params take priority
      await clearSelectionCache(page);

      // Navigate with one valid and one invalid run ID
      await page.goto(`/o/${orgSlug}/projects/${projectName}?runs=${runIds[0]},nonexistent-run-id-12345`);
      await waitForTRPC(page);
      await page.waitForLoadState("networkidle");

      // Should only select the valid run (1 selected)
      const selectionContainer = page.locator('text=runs selected').locator('..');
      await expect(async () => {
        await expect(selectionContainer).toContainText("1", { timeout: 2000 });
      }).toPass({ timeout: 10000 });
    });

    test("empty ?runs= param falls back to default selection", async ({ page }) => {
      // Navigate with empty runs param
      await page.goto(`/o/${orgSlug}/projects/${projectName}?runs=`);
      await waitForTRPC(page);
      await page.waitForLoadState("networkidle");

      // Should fall back to default (first 5 runs selected)
      const selectionContainer = page.locator('text=runs selected').locator('..');
      // Default behavior selects up to 5 runs
      await expect(selectionContainer).toBeVisible({ timeout: 5000 });

      // The count should be > 0 (default selection)
      const text = await selectionContainer.textContent();
      const match = text?.match(/(\d+)\s*of/);
      const count = match ? parseInt(match[1]) : 0;
      expect(count).toBeGreaterThan(0);
    });
  });

  test.describe("URL updates on selection change", () => {
    test("selecting a run updates the URL with runs param", async ({ page }) => {
      // Start fresh without runs param
      await page.goto(`/o/${orgSlug}/projects/${projectName}`);
      await waitForTRPC(page);
      await page.waitForLoadState("networkidle");

      // Deselect all first
      const visibilityButton = page.locator('button[aria-label="Visibility options"]').first();
      if ((await visibilityButton.count()) === 0) {
        test.skip();
        return;
      }

      await visibilityButton.click();
      await page.locator('button:has-text("Deselect all")').click();
      await page.keyboard.press("Escape");
      await page.waitForTimeout(300);

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
      await page.waitForTimeout(600);

      // Verify URL contains the runs param
      const url = page.url();
      expect(url).toContain('runs=');
      expect(url).toContain(runIds[0]);
    });

    test("deselecting all runs removes runs param from URL", async ({ page }) => {
      // First, get a run ID and navigate with it selected
      await page.goto(`/o/${orgSlug}/projects/${projectName}`);
      await waitForTRPC(page);
      await page.waitForLoadState("networkidle");

      const runIds = await getRunIdsFromTable(page, 1);

      if (runIds.length < 1) {
        test.skip();
        return;
      }

      // Navigate with run selected
      await page.goto(`/o/${orgSlug}/projects/${projectName}?runs=${runIds[0]}`);
      await waitForTRPC(page);
      await page.waitForLoadState("networkidle");

      // Deselect all
      const visibilityButton = page.locator('button[aria-label="Visibility options"]').first();
      await visibilityButton.click();
      await page.locator('button:has-text("Deselect all")').click();
      await page.keyboard.press("Escape");

      // Wait for URL to update (debounced)
      await page.waitForTimeout(600);

      // URL should not contain runs param (or should be empty)
      const url = page.url();
      // Either no runs param, or runs= is empty
      expect(url).not.toMatch(/runs=[^&]+/);
    });
  });

  test.describe("URL params combined with other params", () => {
    test("?runs= works together with ?chart= param", async ({ page }) => {
      // Get a run ID first
      await page.goto(`/o/${orgSlug}/projects/${projectName}`);
      await waitForTRPC(page);
      await page.waitForLoadState("networkidle");

      const runIds = await getRunIdsFromTable(page, 1);

      if (runIds.length < 1) {
        test.skip();
        return;
      }

      // Clear cache to ensure URL params take priority
      await clearSelectionCache(page);

      // Navigate with both runs and chart params
      await page.goto(`/o/${orgSlug}/projects/${projectName}?runs=${runIds[0]}&chart=some-chart-id`);
      await waitForTRPC(page);
      await page.waitForLoadState("networkidle");

      // Verify 1 run is selected (runs param works)
      const selectionContainer = page.locator('text=runs selected').locator('..');
      await expect(async () => {
        await expect(selectionContainer).toContainText("1", { timeout: 2000 });
      }).toPass({ timeout: 10000 });

      // Verify URL still has both params
      const url = page.url();
      expect(url).toContain('runs=');
      expect(url).toContain('chart=');
    });
  });

  test.describe("Shareable URLs", () => {
    test("copied URL with runs param can be shared and reproduced", async ({ page, context }) => {
      // Get run IDs
      await page.goto(`/o/${orgSlug}/projects/${projectName}`);
      await waitForTRPC(page);
      await page.waitForLoadState("networkidle");

      const runIds = await getRunIdsFromTable(page, 3);

      if (runIds.length < 3) {
        test.skip();
        return;
      }

      // Construct a shareable URL
      const shareableUrl = `/o/${orgSlug}/projects/${projectName}?runs=${runIds[0]},${runIds[1]},${runIds[2]}`;

      // Open in a new page (simulating sharing)
      // Note: IndexedDB is shared within the same browser context, so clear cache first
      const newPage = await context.newPage();
      await newPage.goto(`/o/${orgSlug}`);  // Navigate to any page to have context for IndexedDB
      await clearSelectionCache(newPage);

      await newPage.goto(shareableUrl);
      await waitForTRPC(newPage);
      await newPage.waitForLoadState("networkidle");

      // Verify exactly 3 runs are selected
      const selectionContainer = newPage.locator('text=runs selected').locator('..');
      await expect(async () => {
        await expect(selectionContainer).toContainText("3", { timeout: 2000 });
      }).toPass({ timeout: 10000 });

      await newPage.close();
    });
  });
});
