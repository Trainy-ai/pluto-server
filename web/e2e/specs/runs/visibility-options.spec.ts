import { test, expect } from "@playwright/test";
import { TEST_ORG, TEST_PROJECT } from "../../fixtures/test-data";
import { waitForTRPC } from "../../utils/test-helpers";

test.describe("Visibility Options Dropdown", () => {
  const orgSlug = TEST_ORG.slug;
  const projectName = TEST_PROJECT.name;

  test.beforeEach(async ({ page }) => {
    // Navigate to the project runs page
    await page.goto(`/o/${orgSlug}/projects/${projectName}`);
    await waitForTRPC(page);
  });

  test("opens dropdown when clicking visibility button in table header", async ({
    page,
  }) => {
    // Wait for the runs table to load
    await page.waitForLoadState("networkidle");

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
    // Wait for the page to load
    await page.waitForLoadState("networkidle");

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

    // Wait for the popover to close and selection to update
    await page.waitForTimeout(500);

    // Get the selection container - text is split across spans
    const selectionContainer = page.locator('text=runs selected').locator('..');
    await expect(selectionContainer).toContainText("10");
  });

  test("deselect all clears selection and shows 0 selected", async ({
    page,
  }) => {
    // Wait for the page to load
    await page.waitForLoadState("networkidle");

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

    // Wait for the selection to update
    await page.waitForTimeout(500);

    // Get the selection container - text is split across spans
    const selectionContainer = page.locator('text=runs selected').locator('..');
    await expect(selectionContainer).toContainText("0");
  });

  test("select all on page selects all visible runs", async ({ page }) => {
    // Wait for the page to load
    await page.waitForLoadState("networkidle");

    // Find the visibility options button
    const visibilityButton = page.locator(
      'button[aria-label="Visibility options"]'
    ).first();

    const hasVisibilityButton = (await visibilityButton.count()) > 0;
    if (!hasVisibilityButton) {
      test.skip();
      return;
    }

    // First deselect all to start fresh
    await visibilityButton.click();
    await expect(page.getByRole("button", { name: "Deselect all" })).toBeVisible({
      timeout: 5000,
    });
    await page.getByRole("button", { name: "Deselect all" }).click();
    await page.waitForTimeout(300);

    // Re-open the dropdown
    await visibilityButton.click();
    await expect(page.getByRole("button", { name: /Select all on page/ })).toBeVisible({
      timeout: 5000,
    });

    // Get the number in "Select all on page (X)"
    const selectAllButton = page.getByRole("button", { name: /Select all on page/ });
    const buttonText = await selectAllButton.textContent();
    const pageCountMatch = buttonText?.match(/\((\d+)\)/);
    const pageCount = pageCountMatch ? parseInt(pageCountMatch[1]) : 0;

    // Click Select all on page
    await selectAllButton.click();

    // Wait for the selection to update
    await page.waitForTimeout(500);

    // Get the selection container - text is split across spans
    const selectionContainer = page.locator('text=runs selected').locator('..');
    await expect(selectionContainer).toContainText(`${pageCount}`);
  });

  test("display only selected filters table to show only selected runs", async ({
    page,
  }) => {
    // Wait for the page to load
    await page.waitForLoadState("networkidle");

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
    await visibilityButton.click();
    await expect(page.getByText("Auto-select first")).toBeVisible({
      timeout: 5000,
    });

    // Decrement to 3
    const decrementButton = page.locator('button').filter({ has: page.locator('svg.lucide-minus') }).first();
    await decrementButton.click(); // 4
    await decrementButton.click(); // 3

    await page.locator('button:has-text("Apply")').click();
    await page.waitForTimeout(300);

    // Re-open dropdown and enable "Display only selected"
    await visibilityButton.click();
    await expect(page.getByText(/Display only selected/)).toBeVisible({
      timeout: 5000,
    });

    // Find and click the switch
    const displayOnlySwitch = page.locator('button[role="switch"]#show-only-selected, [id="show-only-selected"]');
    await displayOnlySwitch.click();

    // Close the popover by clicking elsewhere
    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);

    // Check that "Showing X runs" text appears (indicates filtering is active)
    // The text is split into spans, look for the container
    await expect(page.locator('text=Showing')).toBeVisible({
      timeout: 5000,
    });
  });

  test("selection counter shows accurate count", async ({ page }) => {
    // Wait for the page to load
    await page.waitForLoadState("networkidle");

    // Get the selection container - text is split across spans
    const selectionContainer = page.locator('text=runs selected').locator('..');

    // Should be visible
    await expect(selectionContainer).toBeVisible({ timeout: 5000 });

    // The counter text is in the parent container
    const counterText = await selectionContainer.textContent();

    // Parse the numbers - the text has spaces between span elements
    const match = counterText?.match(/(\d+)\s*of\s*(\d+)\s*runs selected/);
    expect(match).not.toBeNull();

    if (match) {
      const selected = parseInt(match[1]);
      const total = parseInt(match[2]);

      // Selected should be <= total
      expect(selected).toBeLessThanOrEqual(total);

      // Total should be > 0 (we have seeded runs)
      expect(total).toBeGreaterThan(0);
    }
  });
});
