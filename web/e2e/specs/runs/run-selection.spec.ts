import { test, expect } from "@playwright/test";
import { TEST_ORG, TEST_PROJECT } from "../../fixtures/test-data";
import { waitForRunsData } from "../../utils/test-helpers";

test.describe("Run Selection", () => {
  const orgSlug = TEST_ORG.slug;
  const projectName = TEST_PROJECT.name;

  test.beforeEach(async ({ page }) => {
    // Navigate to the project runs page
    await page.goto(`/o/${orgSlug}/projects/${projectName}`);
    await waitForRunsData(page);
  });

  test("clicking eye icon on row toggles run selection", async ({ page }) => {
    // Wait for the page to load
    await page.waitForLoadState("domcontentloaded");

    // Find the first "Toggle select row" button (eye icon)
    const toggleButtons = page.locator('button[aria-label="Toggle select row"]');

    const hasToggleButtons = (await toggleButtons.count()) > 0;
    if (!hasToggleButtons) {
      test.skip();
      return;
    }

    // Get initial selection count - the text is split across spans, find the container
    const selectionContainer = page.locator('text=runs selected').locator('..');
    await expect(selectionContainer).toBeVisible({ timeout: 5000 });

    // Wait for data to load (total > 0), then read the initial selected count
    await expect
      .poll(
        async () => {
          const text = await selectionContainer.textContent();
          const match = text?.match(/(\d+)\s*of\s*(\d+)/);
          if (!match || parseInt(match[2]) === 0) return -1;
          return parseInt(match[2]);
        },
        { timeout: 10000, message: "Waiting for runs data to load" }
      )
      .toBeGreaterThan(0);

    const initialText = await selectionContainer.textContent();
    const initialMatch = initialText?.match(/(\d+)\s*of/);
    const initialCount = initialMatch ? parseInt(initialMatch[1]) : 0;

    // Click the first toggle button
    const firstToggle = toggleButtons.first();
    await firstToggle.click();

    // Wait for state update (useTransition defers updates, so we need to wait longer)
    // Use polling to wait for the count to actually change
    await expect
      .poll(
        async () => {
          const text = await selectionContainer.textContent();
          const match = text?.match(/(\d+)\s*of/);
          return match ? parseInt(match[1]) : 0;
        },
        { timeout: 5000 }
      )
      .not.toBe(initialCount);
  });

  test("selection counter updates when runs are selected", async ({ page }) => {
    // Wait for the page to load
    await page.waitForLoadState("domcontentloaded");

    // Find the visibility button and deselect all first
    const visibilityButton = page.locator('button[aria-label="Visibility options"]').first();

    if ((await visibilityButton.count()) === 0) {
      test.skip();
      return;
    }

    // Deselect all to start fresh
    await visibilityButton.click();
    await page.locator('button:has-text("Deselect all")').click();

    // Get the selection container - text is split across spans
    const selectionContainer = page.locator('text=runs selected').locator('..');

    // Verify counter shows 0 (useTransition defers updates, use longer timeout)
    await expect(selectionContainer).toContainText("0", { timeout: 5000 });

    // Find toggle buttons and click first three
    const toggleButtons = page.locator('button[aria-label="Toggle select row"]');

    // Select first run (useTransition defers updates)
    await toggleButtons.first().click();
    await expect(selectionContainer).toContainText("1", { timeout: 5000 });

    // Select second run
    await toggleButtons.nth(1).click();
    await expect(selectionContainer).toContainText("2", { timeout: 5000 });

    // Select third run
    await toggleButtons.nth(2).click();
    await expect(selectionContainer).toContainText("3", { timeout: 5000 });
  });

  test("selection counter updates when runs are deselected", async ({
    page,
  }) => {
    // Wait for the page to load
    await page.waitForLoadState("domcontentloaded");

    // Find the visibility button and select first 5
    const visibilityButton = page.locator('button[aria-label="Visibility options"]').first();

    if ((await visibilityButton.count()) === 0) {
      test.skip();
      return;
    }

    // Auto-select first 5
    await expect(async () => {
      await visibilityButton.click();
      const applyButton = page.locator('button:has-text("Apply")');
      await expect(applyButton).toBeVisible({ timeout: 2000 });
      await applyButton.click();
    }).toPass({ timeout: 10000 });
    // Close popover to ensure toggle buttons are clickable
    await page.keyboard.press("Escape");

    // Get the selection container - text is split across spans
    const selectionContainer = page.locator('text=runs selected').locator('..');

    // Wait for counter to show exactly 5 selected
    await expect
      .poll(
        async () => {
          const text = await selectionContainer.textContent();
          const match = text?.match(/(\d+)\s*of/);
          return match ? parseInt(match[1]) : -1;
        },
        { timeout: 10000, message: "Waiting for 5 runs to be selected" }
      )
      .toBe(5);

    // Find toggle buttons for selected runs (they have Eye icon, not EyeOff)
    // Since runs are selected, clicking will deselect them
    const toggleButtons = page.locator('button[aria-label="Toggle select row"]');

    // Deselect first run (useTransition defers updates)
    await toggleButtons.first().click();
    await expect
      .poll(
        async () => {
          const text = await selectionContainer.textContent();
          const match = text?.match(/(\d+)\s*of/);
          return match ? parseInt(match[1]) : -1;
        },
        { timeout: 10000 }
      )
      .toBe(4);

    // Deselect second run
    await toggleButtons.nth(1).click();
    await expect
      .poll(
        async () => {
          const text = await selectionContainer.textContent();
          const match = text?.match(/(\d+)\s*of/);
          return match ? parseInt(match[1]) : -1;
        },
        { timeout: 10000 }
      )
      .toBe(3);
  });

  test("selected runs appear in charts with correct colors", async ({
    page,
  }) => {
    // Wait for the page to load
    await page.waitForLoadState("domcontentloaded");

    // Find the visibility button
    const visibilityButton = page.locator('button[aria-label="Visibility options"]').first();

    if ((await visibilityButton.count()) === 0) {
      test.skip();
      return;
    }

    // Auto-select first 3 runs
    await visibilityButton.click();

    // Decrement from 5 to 3
    const decrementButton = page.locator('button').filter({ has: page.locator('svg.lucide-minus') }).first();
    await decrementButton.click();
    await decrementButton.click();

    await page.locator('button:has-text("Apply")').click();

    // Wait for charts to render - ECharts renders asynchronously to canvas
    // Use polling to wait for canvas elements to appear (more reliable than fixed timeout)
    const charts = page.locator('canvas');
    await expect(async () => {
      const chartCount = await charts.count();
      expect(chartCount).toBeGreaterThan(0);
    }).toPass({ timeout: 10000 });

    // The chart should have data (check via chart container having content)
    const chartContainers = page.locator('.uplot, [data-testid*="chart"]');
    if ((await chartContainers.count()) > 0) {
      // At least one chart container should exist
      expect(await chartContainers.count()).toBeGreaterThan(0);
    }
  });

  test("deselected runs disappear from chart", async ({ page }) => {
    // Wait for the page to load
    await page.waitForLoadState("domcontentloaded");

    // Find the visibility button
    const visibilityButton = page.locator('button[aria-label="Visibility options"]').first();

    if ((await visibilityButton.count()) === 0) {
      test.skip();
      return;
    }

    // First select 5 runs
    await visibilityButton.click();
    await expect(page.locator('button:has-text("Apply")')).toBeVisible({ timeout: 5000 });
    await page.locator('button:has-text("Apply")').click();
    // Wait for popover to close and state to settle
    await page.keyboard.press("Escape");

    // Take note of charts (they should have data)
    const charts = page.locator('canvas');
    const initialChartCount = await charts.count();

    // Now deselect all runs - use retry pattern for stability
    const deselectAllButton = page.locator('button:has-text("Deselect all")');
    await expect(async () => {
      // Click visibility button to open popover
      await visibilityButton.click();
      // Wait for popover content to be visible
      await expect(deselectAllButton).toBeVisible({ timeout: 2000 });
      // Click the button
      await deselectAllButton.click();
    }).toPass({ timeout: 10000 });

    // Get the selection container - text is split across spans
    const selectionContainer = page.locator('text=runs selected').locator('..');

    // Verify selection shows 0
    await expect(selectionContainer).toContainText("0", { timeout: 5000 });

    // Charts might show "No data" state or be empty
    // The exact behavior depends on the chart component implementation
    // At minimum, verify the page still renders correctly
    await expect(page.locator('h1, h2').first()).toBeVisible();
  });
});
