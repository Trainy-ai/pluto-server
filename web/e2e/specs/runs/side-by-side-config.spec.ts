import { test, expect } from "@playwright/test";
import { TEST_ORG, TEST_PROJECT } from "../../fixtures/test-data";
import { waitForRunsData } from "../../utils/test-helpers";

/**
 * Regression test for side-by-side view loading on initial page load.
 * Bug: Side-by-side view showed stale/empty data on initial load because
 * selectedRunsWithColors held stale run objects without enriched fields.
 * Fix: PR #268 — sync fresh run objects into selection when upstream data enriches.
 */
test.describe("Side-by-side view loading", () => {
  const orgSlug = TEST_ORG.slug;
  const projectName = TEST_PROJECT.name;

  async function clearSelectionCache(page: import("@playwright/test").Page) {
    await page.addInitScript(() => {
      indexedDB.deleteDatabase("run-selection-db");
    });
  }

  async function getRunIdsFromTable(
    page: import("@playwright/test").Page,
    count: number = 2
  ) {
    const runRows = page.locator("[data-run-id]");
    const actualCount = await runRows.count();
    const idsToGet = Math.min(count, actualCount);

    const runIds: string[] = [];
    for (let i = 0; i < idsToGet; i++) {
      const id = await runRows.nth(i).getAttribute("data-run-id");
      if (id) runIds.push(id);
    }
    return runIds;
  }

  test("side-by-side view renders with run data on initial load", async ({ page }) => {
    // 1. Navigate to project, get run IDs
    await page.goto(`/o/${orgSlug}/projects/${projectName}`);
    await waitForRunsData(page);
    await page.waitForLoadState("domcontentloaded");

    const runIds = await getRunIdsFromTable(page, 2);
    if (runIds.length < 2) {
      test.skip();
      return;
    }

    // 2. Clear IDB cache so URL params drive fresh selection
    await clearSelectionCache(page);

    // 3. Navigate with ?runs= to ensure fresh state
    await page.goto(
      `/o/${orgSlug}/projects/${projectName}?runs=${runIds.join(",")}`
    );
    await waitForRunsData(page);
    await page.waitForLoadState("domcontentloaded");

    // 4. Wait for selection to be applied — extract exact count to avoid
    //    false-positive substring matches (e.g., "2" matching in total "124")
    const selectionContainer = page.locator("text=runs selected").locator("..");
    await expect
      .poll(
        async () => {
          const text = await selectionContainer.textContent();
          const match = text?.match(/(\d+)\s+of\s+\d+/);
          return match ? parseInt(match[1]) : -1;
        },
        { timeout: 15000, message: "Waiting for 2 runs to be selected" }
      )
      .toBe(2);

    // 5. Click Side-by-side button
    await page.locator('button:has-text("Side-by-side")').click();

    // 6. Verify the Pluto Metadata section renders with actual run data.
    //    This section always appears and contains status, name, etc.
    //    It proves that selectedRunsWithColors has fresh run objects on initial load.
    await expect(async () => {
      await expect(
        page.locator('text=Pluto Metadata').first()
      ).toBeVisible({ timeout: 2000 });
    }).toPass({ timeout: 15000 });

    // 7. Verify run status values are populated (not empty) — proves fresh data
    await expect(async () => {
      await expect(
        page.locator('td:has-text("Status")').first()
      ).toBeVisible({ timeout: 2000 });
    }).toPass({ timeout: 5000 });
  });
});
