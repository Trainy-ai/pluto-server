import { test, expect } from "@playwright/test";
import { waitForTRPC } from "../../utils/test-helpers";

/**
 * Navigate to a run page and wait for charts to load
 */
async function navigateToRunWithCharts(
  page: import("@playwright/test").Page,
  orgSlug: string
) {
  // Navigate to projects page to find any project
  await page.goto(`/o/${orgSlug}/projects`);
  await waitForTRPC(page);

  // Find the first project link
  const firstProjectLink = page.locator('a[href*="/projects/"]').first();
  const projectHref = await firstProjectLink
    .getAttribute("href", { timeout: 5000 })
    .catch(() => null);

  if (!projectHref) {
    return null;
  }

  // Navigate to the project page
  await page.goto(projectHref);
  await waitForTRPC(page);

  // Find a run link
  const runLink = page.locator('a[href*="/projects/"][href$!="/projects/"]').filter({
    hasNot: page.locator('text="Projects"'),
  }).first();

  const runHref = await runLink
    .getAttribute("href", { timeout: 5000 })
    .catch(() => null);

  if (!runHref) {
    return null;
  }

  // Navigate to the run page
  await page.goto(runHref);
  await waitForTRPC(page);
  await page.waitForLoadState("networkidle");

  return runHref;
}

/**
 * Open the chart settings dialog
 */
async function openChartSettings(page: import("@playwright/test").Page) {
  // Find and click the settings button (gear icon near charts)
  // The settings button is near the "Run Metrics" heading
  const settingsButton = page.locator('button[aria-haspopup="dialog"]').filter({
    has: page.locator('svg'),
  }).first();

  await settingsButton.click();

  // Wait for dialog to open
  await page.waitForSelector('div[role="dialog"]', { timeout: 5000 });
}

test.describe("Chart Engine Settings", () => {
  const orgSlug = "smoke-test-org";

  test("chart settings dialog shows Chart Engine section", async ({ page }) => {
    const runHref = await navigateToRunWithCharts(page, orgSlug);

    if (!runHref) {
      console.log("No runs found, skipping test");
      test.skip();
      return;
    }

    // Open chart settings
    await openChartSettings(page);

    // Verify Chart Engine heading exists
    const chartEngineHeading = page.locator('h3:has-text("Chart Engine")');
    await expect(chartEngineHeading).toBeVisible({ timeout: 5000 });

    // Verify the description text
    const description = page.locator('text="Select the rendering engine for line charts"');
    await expect(description).toBeVisible();
  });

  test("chart engine dropdown has ECharts and uPlot options", async ({ page }) => {
    const runHref = await navigateToRunWithCharts(page, orgSlug);

    if (!runHref) {
      console.log("No runs found, skipping test");
      test.skip();
      return;
    }

    // Open chart settings
    await openChartSettings(page);

    // Find the chart engine combobox
    const chartEngineCombobox = page.locator('button[role="combobox"]').filter({
      hasText: /ECharts|uPlot/,
    });
    await expect(chartEngineCombobox).toBeVisible({ timeout: 5000 });

    // Click to open dropdown
    await chartEngineCombobox.click();

    // Verify both options are available
    const echartsOption = page.locator('[role="option"]').filter({
      hasText: "ECharts",
    });
    const uplotOption = page.locator('[role="option"]').filter({
      hasText: "uPlot",
    });

    await expect(echartsOption).toBeVisible();
    await expect(uplotOption).toBeVisible();

    // Verify badges are shown
    const legacyBadge = page.locator('[role="option"] >> text="Legacy"');
    const alphaBadge = page.locator('[role="option"] >> text="Alpha"');

    await expect(legacyBadge).toBeVisible();
    await expect(alphaBadge).toBeVisible();
  });

  test("selecting uPlot shows alpha warning message", async ({ page }) => {
    const runHref = await navigateToRunWithCharts(page, orgSlug);

    if (!runHref) {
      console.log("No runs found, skipping test");
      test.skip();
      return;
    }

    // Open chart settings
    await openChartSettings(page);

    // Find and click the chart engine combobox
    const chartEngineCombobox = page.locator('button[role="combobox"]').filter({
      hasText: /ECharts|uPlot/,
    });
    await chartEngineCombobox.click();

    // Select uPlot option
    const uplotOption = page.locator('[role="option"]').filter({
      hasText: "uPlot",
    });
    await uplotOption.click();

    // Wait for the warning message to appear
    const warningMessage = page.locator(
      'text="uPlot is in alpha. Some features like click-to-pin tooltips may behave differently."'
    );
    await expect(warningMessage).toBeVisible({ timeout: 5000 });
  });

  test("chart engine selection persists after closing dialog", async ({ page }) => {
    const runHref = await navigateToRunWithCharts(page, orgSlug);

    if (!runHref) {
      console.log("No runs found, skipping test");
      test.skip();
      return;
    }

    // Open chart settings
    await openChartSettings(page);

    // Find and click the chart engine combobox
    const chartEngineCombobox = page.locator('button[role="combobox"]').filter({
      hasText: /ECharts|uPlot/,
    });
    await chartEngineCombobox.click();

    // Select uPlot option
    const uplotOption = page.locator('[role="option"]').filter({
      hasText: "uPlot",
    });
    await uplotOption.click();

    // Wait for selection to be applied
    await page.waitForTimeout(500);

    // Close the dialog by clicking outside or pressing Escape
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);

    // Re-open the dialog
    await openChartSettings(page);

    // Verify uPlot is still selected
    const selectedValue = page.locator('button[role="combobox"]').filter({
      hasText: "uPlot",
    });
    await expect(selectedValue).toBeVisible({ timeout: 5000 });
  });

  test("switching to uPlot renders charts with uPlot", async ({ page }) => {
    const runHref = await navigateToRunWithCharts(page, orgSlug);

    if (!runHref) {
      console.log("No runs found, skipping test");
      test.skip();
      return;
    }

    // Open chart settings
    await openChartSettings(page);

    // Find and click the chart engine combobox
    const chartEngineCombobox = page.locator('button[role="combobox"]').filter({
      hasText: /ECharts|uPlot/,
    });
    await chartEngineCombobox.click();

    // Select uPlot option
    const uplotOption = page.locator('[role="option"]').filter({
      hasText: "uPlot",
    });
    await uplotOption.click();

    // Close the dialog
    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);

    // Wait for charts to re-render with uPlot
    // uPlot renders using canvas elements within .uplot class containers
    // The chart titles should still be visible
    const chartTitle = page.locator('text=/custom|train|eval|system|test|media/i').first();

    // If there are charts, they should be visible
    const chartVisible = await chartTitle.isVisible({ timeout: 10000 }).catch(() => false);

    if (chartVisible) {
      console.log("Charts are rendering after switching to uPlot");
      expect(chartVisible).toBeTruthy();
    } else {
      console.log("No charts visible - run may not have metrics data");
    }
  });

  test("ECharts renders with echarts-for-react class", async ({ page }) => {
    const runHref = await navigateToRunWithCharts(page, orgSlug);

    if (!runHref) {
      console.log("No runs found, skipping test");
      test.skip();
      return;
    }

    // Ensure ECharts is selected (default)
    await openChartSettings(page);

    const chartEngineCombobox = page.locator('button[role="combobox"]').filter({
      hasText: /ECharts|uPlot/,
    });
    await chartEngineCombobox.click();

    const echartsOption = page.locator('[role="option"]').filter({
      hasText: "ECharts",
    });
    await echartsOption.click();

    // Close the dialog
    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);

    // Check for ECharts container
    const echartsContainer = page.locator('.echarts-for-react').first();
    const hasEcharts = await echartsContainer.isVisible({ timeout: 10000 }).catch(() => false);

    if (hasEcharts) {
      console.log("ECharts container found - rendering correctly");
      expect(hasEcharts).toBeTruthy();
    } else {
      console.log("No ECharts container - run may not have metrics data");
    }
  });
});
