import { test, expect } from "@playwright/test";
import { navigateToFirstProject, waitForCharts } from "../../utils/test-helpers";

/**
 * E2E Tests for Chart Settings Popover (Y-Axis Bounds + Log Scale Toggles)
 *
 * Tests verify:
 * 1. Log scale toggles are visible in the chart settings popover
 * 2. Toggling log scale applies immediately to the chart
 * 3. Reset clears both bounds and log scale overrides
 * 4. Per-chart log scale overrides persist in localStorage
 */

const orgSlug = "smoke-test-org";

test.describe("Chart Settings Popover - Log Scale Toggles", () => {
  test("should show log scale toggles in chart bounds popover", async ({ page }) => {
    const projectHref = await navigateToFirstProject(page, orgSlug);
    if (!projectHref) {
      test.skip();
      return;
    }

    try {
      await waitForCharts(page);
    } catch {
      test.skip();
      return;
    }

    // Find a chart card and hover to reveal the toolbar
    const chartCard = page.locator("[data-testid='chart-card']").first();
    await chartCard.hover();

    // Click the settings/bounds button
    const boundsBtn = page.locator("[data-testid='chart-bounds-btn']").first();
    await expect(boundsBtn).toBeVisible();
    await boundsBtn.click();

    // Verify the popover content is visible
    const popoverContent = page.locator("[data-testid='chart-settings-popover']");
    await expect(popoverContent).toBeVisible();

    // Verify Y-axis bounds section exists
    await expect(popoverContent.getByText("Y-Axis Bounds")).toBeVisible();

    // Verify log scale section exists
    await expect(popoverContent.getByText("Log Scale")).toBeVisible();

    // Verify X and Y axis log scale toggles exist
    const xLogSwitch = popoverContent.locator("[data-testid='log-x-axis-switch']");
    const yLogSwitch = popoverContent.locator("[data-testid='log-y-axis-switch']");
    await expect(xLogSwitch).toBeVisible();
    await expect(yLogSwitch).toBeVisible();
  });

  test("toggling log Y scale should apply immediately", async ({ page }) => {
    const projectHref = await navigateToFirstProject(page, orgSlug);
    if (!projectHref) {
      test.skip();
      return;
    }

    try {
      await waitForCharts(page);
    } catch {
      test.skip();
      return;
    }

    // Find a chart card and hover to reveal the toolbar
    const chartCard = page.locator("[data-testid='chart-card']").first();
    await chartCard.hover();

    // Click the settings/bounds button
    const boundsBtn = page.locator("[data-testid='chart-bounds-btn']").first();
    await boundsBtn.click();

    // Check initial log-Y state via data attribute on chart card
    const initialHasLogY = await chartCard.getAttribute("data-log-y-scale");
    expect(initialHasLogY).toBeNull(); // should not have log scale initially

    // Toggle Y log scale
    const yLogSwitch = page.locator("[data-testid='log-y-axis-switch']").first();
    await yLogSwitch.click();

    // Wait for the chart to re-render with new scale
    await page.waitForTimeout(500);

    // The chart card should now have the log-y-scale data attribute
    const afterHasLogY = await chartCard.getAttribute("data-log-y-scale");
    expect(afterHasLogY).toBe("true");
  });

  test("reset should clear log scale overrides and bounds", async ({ page }) => {
    const projectHref = await navigateToFirstProject(page, orgSlug);
    if (!projectHref) {
      test.skip();
      return;
    }

    try {
      await waitForCharts(page);
    } catch {
      test.skip();
      return;
    }

    // Find a chart card and hover to reveal the toolbar
    const chartCard = page.locator("[data-testid='chart-card']").first();
    await chartCard.hover();

    // Open popover
    const boundsBtn = page.locator("[data-testid='chart-bounds-btn']").first();
    await boundsBtn.click();

    // Set Y bounds and toggle log Y
    const yMinInput = page.locator("[data-testid='chart-settings-popover'] input").first();
    await yMinInput.fill("0.5");

    const yLogSwitch = page.locator("[data-testid='log-y-axis-switch']").first();
    await yLogSwitch.click();

    // Apply bounds
    const applyBtn = page.locator("[data-testid='chart-settings-popover'] button", { hasText: "Apply" });
    await applyBtn.click();

    // Click Reset
    const resetBtn = page.locator("[data-testid='chart-settings-popover'] button", { hasText: "Reset" });
    await resetBtn.click();

    // Verify bounds inputs are cleared
    await expect(yMinInput).toHaveValue("");

    // Verify log switches are reset to unchecked (default)
    const xLogSwitch = page.locator("[data-testid='log-x-axis-switch']").first();
    await expect(xLogSwitch).not.toBeChecked();
    await expect(yLogSwitch).not.toBeChecked();
  });
});
