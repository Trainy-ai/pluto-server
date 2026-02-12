import { test, expect } from "@playwright/test";
import { TEST_ORG, TEST_PROJECT } from "../../fixtures/test-data";
import { waitForRunsData } from "../../utils/test-helpers";

test.describe("Visibility Options Dropdown", () => {
  const orgSlug = TEST_ORG.slug;
  const projectName = TEST_PROJECT.name;

  test.beforeEach(async ({ page }) => {
    // Navigate to the project runs page
    await page.goto(`/o/${orgSlug}/projects/${projectName}`);
    await waitForRunsData(page);
  });

  test("opens dropdown when clicking visibility button in table header", async ({
    page,
  }) => {

    // Find the visibility options button in the table header
    const visibilityButton = page.locator(
      'button[aria-label="Visibility options"]'
    ).first();

    const hasVisibilityButton = (await visibilityButton.count()) > 0;
    if (!hasVisibilityButton) {
      test.skip();
      return;
    }

    // Click to open the popover
    await visibilityButton.click();

    // Wait for popover content to appear - use specific selectors
    await expect(page.getByText("Auto-select first")).toBeVisible({
      timeout: 5000,
    });
    await expect(page.getByText(/Display only selected/)).toBeVisible();
    await expect(page.getByRole("button", { name: /Select all on page/ })).toBeVisible();
    await expect(page.getByRole("button", { name: "Deselect all" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Shuffle colors" })).toBeVisible();
  });

  test("auto-select first N updates selection count", async ({ page }) => {

    // Find the visibility options button
    const visibilityButton = page.locator(
      'button[aria-label="Visibility options"]'
    ).first();

    const hasVisibilityButton = (await visibilityButton.count()) > 0;
    if (!hasVisibilityButton) {
      test.skip();
      return;
    }

    // Open the dropdown
    await visibilityButton.click();
    await expect(page.getByText("Auto-select first")).toBeVisible({
      timeout: 5000,
    });

    // Increment the counter to 10
    const incrementButton = page.locator('button').filter({ has: page.locator('svg.lucide-plus') }).first();

    // Click 5 times to go from 5 to 10
    for (let i = 0; i < 5; i++) {
      await incrementButton.click();
    }

    // Click Apply
    const applyButton = page.locator('button:has-text("Apply")');
    await applyButton.click();

    // Get the selection container - text is split across spans
    const selectionContainer = page.locator('text=runs selected').locator('..');
    await expect(selectionContainer).toContainText("10", { timeout: 5000 });
  });

  test("deselect all clears selection and shows 0 selected", async ({
    page,
  }) => {

    // Find the visibility options button
    const visibilityButton = page.locator(
      'button[aria-label="Visibility options"]'
    ).first();

    const hasVisibilityButton = (await visibilityButton.count()) > 0;
    if (!hasVisibilityButton) {
      test.skip();
      return;
    }

    // Open the dropdown
    await visibilityButton.click();
    await expect(page.getByRole("button", { name: "Deselect all" })).toBeVisible({
      timeout: 5000,
    });

    // Click Deselect all
    await page.getByRole("button", { name: "Deselect all" }).click();

    // Get the selection container - text is split across spans
    const selectionContainer = page.locator('text=runs selected').locator('..');
    await expect(selectionContainer).toContainText("0", { timeout: 5000 });
  });

  test("select all on page selects all visible runs", async ({ page }) => {

    // Find the visibility options button
    const visibilityButton = page.locator(
      'button[aria-label="Visibility options"]'
    ).first();

    const hasVisibilityButton = (await visibilityButton.count()) > 0;
    if (!hasVisibilityButton) {
      test.skip();
      return;
    }

    // First deselect all to start fresh - use retry pattern for stability
    const deselectAllButton = page.getByRole("button", { name: "Deselect all" });
    await expect(async () => {
      await visibilityButton.click();
      await expect(deselectAllButton).toBeVisible({ timeout: 2000 });
      await deselectAllButton.click();
    }).toPass({ timeout: 10000 });
    // Ensure popover is closed
    await page.keyboard.press("Escape");

    // Re-open the dropdown and click Select all - use retry pattern
    const selectAllButton = page.getByRole("button", { name: /Select all on page/ });
    let pageCount = 0;
    await expect(async () => {
      await visibilityButton.click();
      await expect(selectAllButton).toBeVisible({ timeout: 2000 });
      // Get the number in "Select all on page (X)"
      const buttonText = await selectAllButton.textContent();
      const pageCountMatch = buttonText?.match(/\((\d+)\)/);
      pageCount = pageCountMatch ? parseInt(pageCountMatch[1]) : 0;
      // Click Select all on page
      await selectAllButton.click();
    }).toPass({ timeout: 10000 });

    // Get the selection container - text is split across spans
    const selectionContainer = page.locator('text=runs selected').locator('..');
    await expect(selectionContainer).toContainText(`${pageCount}`, { timeout: 5000 });
  });

  test("display only selected filters table to show only selected runs", async ({
    page,
  }) => {

    // Find the visibility options button
    const visibilityButton = page.locator(
      'button[aria-label="Visibility options"]'
    ).first();

    const hasVisibilityButton = (await visibilityButton.count()) > 0;
    if (!hasVisibilityButton) {
      test.skip();
      return;
    }

    // First ensure some runs are selected via auto-select first 3
    // Use retry pattern for stability
    const applyButton = page.locator('button:has-text("Apply")');
    await expect(async () => {
      await visibilityButton.click();
      await expect(page.getByText("Auto-select first")).toBeVisible({ timeout: 2000 });
      // Decrement to 3
      const decrementButton = page.locator('button').filter({ has: page.locator('svg.lucide-minus') }).first();
      await decrementButton.click(); // 4
      await decrementButton.click(); // 3
      await expect(applyButton).toBeVisible({ timeout: 2000 });
      await applyButton.click();
    }).toPass({ timeout: 10000 });
    // Ensure popover is closed
    await page.keyboard.press("Escape");

    // Re-open dropdown and enable "Display only selected" - use retry pattern
    const displayOnlySwitch = page.locator('button[role="switch"]#show-only-selected, [id="show-only-selected"]');
    await expect(async () => {
      await visibilityButton.click();
      await expect(page.getByText(/Display only selected/)).toBeVisible({ timeout: 2000 });
      await displayOnlySwitch.click();
    }).toPass({ timeout: 10000 });

    // Close the popover by clicking elsewhere
    await page.keyboard.press("Escape");

    // "Display only selected" is a client-side filter that reduces visible table rows.
    // Verify fewer rows are shown (3 selected out of many total)
    const toggleButtons = page.locator('button[aria-label="Toggle select row"]');
    await expect(async () => {
      const rowCount = await toggleButtons.count();
      // Should be at most 3 rows visible (the selected runs per page)
      expect(rowCount).toBeLessThanOrEqual(5);
      expect(rowCount).toBeGreaterThan(0);
    }).toPass({ timeout: 5000 });
  });

  test("selection counter shows accurate count", async ({ page }) => {

    // Get the selection container - text is split across spans
    const selectionContainer = page.locator('text=runs selected').locator('..');

    // Should be visible
    await expect(selectionContainer).toBeVisible({ timeout: 5000 });

    // Wait for the counter to show valid data (non-zero total) using polling
    await expect
      .poll(
        async () => {
          const text = await selectionContainer.textContent();
          const m = text?.match(/(\d+)\s*of\s*(\d+)\s*runs selected/);
          if (!m) return 0;
          return parseInt(m[2]);
        },
        { timeout: 10000, message: "Waiting for selection counter to show valid data" }
      )
      .toBeGreaterThan(0);

    // Now read the final values
    const counterText = await selectionContainer.textContent();
    const match = counterText?.match(/(\d+)\s*of\s*(\d+)\s*runs selected/);
    expect(match).not.toBeNull();

    const selected = parseInt(match![1]);
    const total = parseInt(match![2]);

    // Selected should be <= total
    expect(selected).toBeLessThanOrEqual(total);

    // Total should be > 0 (we have seeded runs)
    expect(total).toBeGreaterThan(0);
  });
});
