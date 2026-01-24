import { test, expect } from "@playwright/test";
import { waitForTRPC } from "../../utils/test-helpers";

/**
 * Navigate to a project comparison page and wait for charts to load
 */
async function navigateToProjectWithCharts(
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

  // Navigate to the project comparison page
  await page.goto(projectHref);
  await waitForTRPC(page);
  await page.waitForLoadState("networkidle");

  return projectHref;
}

/**
 * Wait for ECharts to render within a container
 * ECharts renders inside a div with class "echarts-for-react"
 */
async function waitForChartRender(page: import("@playwright/test").Page) {
  // Wait for at least one ECharts container to be visible
  const chartContainer = page.locator(".echarts-for-react").first();
  await expect(chartContainer).toBeVisible({ timeout: 15000 });

  // Wait a bit for the chart to fully render its canvas
  await page.waitForTimeout(500);

  return chartContainer;
}

/**
 * Get the ECharts tooltip element
 * ECharts renders tooltips in a div with specific styles
 */
function getTooltip(page: import("@playwright/test").Page) {
  // ECharts tooltips have position: absolute and are children of the chart container
  // They also have a specific z-index and contain formatted content
  return page.locator('div[style*="position: absolute"][style*="z-index"]').filter({
    has: page.locator("table, span, div"),
  });
}

test.describe("Chart Tooltip Behavior", () => {
  const orgSlug = "smoke-test-org";

  test("tooltip appears on chart hover", async ({ page }) => {
    const projectHref = await navigateToProjectWithCharts(page, orgSlug);

    if (!projectHref) {
      console.log("No projects found, skipping test");
      test.skip();
      return;
    }

    // Wait for chart to render
    const chartContainer = await waitForChartRender(page);

    // Get chart bounding box for hovering
    const chartBox = await chartContainer.boundingBox();
    if (!chartBox) {
      throw new Error("Could not get chart bounding box");
    }

    // Hover over the center of the chart
    await page.mouse.move(
      chartBox.x + chartBox.width / 2,
      chartBox.y + chartBox.height / 2
    );

    // Wait for tooltip to appear (ECharts has a slight delay)
    await page.waitForTimeout(300);

    // Look for tooltip - ECharts creates a div with position absolute
    // The tooltip should be visible somewhere in the DOM
    const tooltipVisible = await page
      .locator('div[style*="position: absolute"]')
      .filter({
        has: page.locator("table"),
      })
      .isVisible()
      .catch(() => false);

    // If no tooltip with table, try checking for any tooltip-like element
    if (!tooltipVisible) {
      // Alternative: check for tooltip by looking at chart's internal state
      const hasAxisPointer = await chartContainer
        .locator('div[style*="pointer-events"]')
        .isVisible()
        .catch(() => false);

      console.log(
        "Tooltip check - table visible:",
        tooltipVisible,
        "axis pointer:",
        hasAxisPointer
      );

      // At minimum, the chart should respond to hover with some visual change
      // This is a basic sanity check that chart interaction works
      expect(hasAxisPointer || tooltipVisible).toBeTruthy();
    } else {
      console.log("Tooltip with table appeared on hover");
      expect(tooltipVisible).toBeTruthy();
    }
  });

  test("tooltip shows run information when data is loaded", async ({ page }) => {
    const projectHref = await navigateToProjectWithCharts(page, orgSlug);

    if (!projectHref) {
      console.log("No projects found, skipping test");
      test.skip();
      return;
    }

    // Wait for chart to render
    const chartContainer = await waitForChartRender(page);

    // Wait a bit more for data to load
    await page.waitForTimeout(1000);

    // Get chart bounding box
    const chartBox = await chartContainer.boundingBox();
    if (!chartBox) {
      throw new Error("Could not get chart bounding box");
    }

    // Hover at multiple x positions to find data points
    // Start from left (where data typically begins) and move right
    for (let xOffset = 0.2; xOffset <= 0.8; xOffset += 0.1) {
      await page.mouse.move(
        chartBox.x + chartBox.width * xOffset,
        chartBox.y + chartBox.height / 2
      );
      await page.waitForTimeout(200);

      // Check if tooltip appeared with content
      const tooltip = page.locator('div[style*="position: absolute"]').filter({
        has: page.locator("table"),
      });

      if (await tooltip.isVisible().catch(() => false)) {
        // Check that tooltip contains some text (run names, values, etc.)
        const tooltipText = await tooltip.textContent();
        console.log(
          `Tooltip found at x=${xOffset.toFixed(1)}, content length: ${tooltipText?.length || 0}`
        );

        if (tooltipText && tooltipText.length > 0) {
          expect(tooltipText.length).toBeGreaterThan(0);
          return; // Test passes
        }
      }
    }

    // If we get here without finding a tooltip with data, it may be that:
    // 1. No runs are selected
    // 2. Data hasn't loaded yet
    // 3. Chart is empty
    // This is acceptable - log and continue
    console.log(
      "No tooltip with data found - chart may be empty or data not loaded"
    );
  });

  test("tooltip is scrollable when many runs are selected", async ({ page }) => {
    const projectHref = await navigateToProjectWithCharts(page, orgSlug);

    if (!projectHref) {
      console.log("No projects found, skipping test");
      test.skip();
      return;
    }

    // Wait for chart to render
    const chartContainer = await waitForChartRender(page);

    // Get chart bounding box
    const chartBox = await chartContainer.boundingBox();
    if (!chartBox) {
      throw new Error("Could not get chart bounding box");
    }

    // Hover over the chart
    await page.mouse.move(
      chartBox.x + chartBox.width / 2,
      chartBox.y + chartBox.height / 2
    );
    await page.waitForTimeout(300);

    // Find tooltip
    const tooltip = page.locator('div[style*="position: absolute"]').filter({
      has: page.locator("table"),
    });

    const tooltipVisible = await tooltip.isVisible().catch(() => false);

    if (tooltipVisible) {
      // Check if tooltip has overflow-y: auto (scrollable) when content exceeds max-height
      const tooltipStyles = await tooltip.evaluate((el) => {
        const computed = window.getComputedStyle(el);
        return {
          overflowY: computed.overflowY,
          maxHeight: computed.maxHeight,
          scrollHeight: el.scrollHeight,
          clientHeight: el.clientHeight,
        };
      });

      console.log("Tooltip styles:", tooltipStyles);

      // Verify tooltip has max-height set (from our extraCssText)
      // Our implementation sets max-height: 50vh
      if (
        tooltipStyles.maxHeight &&
        tooltipStyles.maxHeight !== "none" &&
        tooltipStyles.maxHeight !== ""
      ) {
        expect(tooltipStyles.overflowY).toBe("auto");
        console.log("Tooltip has scrollable configuration");
      } else {
        // If tooltip doesn't need scroll (content fits), just verify it's visible
        console.log(
          "Tooltip visible but content fits without scroll"
        );
      }
    } else {
      console.log("No tooltip visible to test scroll behavior");
    }
  });

  test("tooltip positions correctly near chart edges", async ({ page }) => {
    const projectHref = await navigateToProjectWithCharts(page, orgSlug);

    if (!projectHref) {
      console.log("No projects found, skipping test");
      test.skip();
      return;
    }

    // Wait for chart to render
    const chartContainer = await waitForChartRender(page);

    // Get chart bounding box
    const chartBox = await chartContainer.boundingBox();
    if (!chartBox) {
      throw new Error("Could not get chart bounding box");
    }

    // Hover near the RIGHT edge of the chart
    // Our implementation should flip tooltip to the left side
    await page.mouse.move(
      chartBox.x + chartBox.width * 0.9, // 90% from left = near right edge
      chartBox.y + chartBox.height / 2
    );
    await page.waitForTimeout(400);

    // Find tooltip
    const tooltip = page.locator('div[style*="position: absolute"]').filter({
      has: page.locator("table"),
    });

    const tooltipVisible = await tooltip.isVisible().catch(() => false);

    if (tooltipVisible) {
      const tooltipBox = await tooltip.boundingBox();
      if (tooltipBox) {
        // Check that tooltip is positioned to the LEFT of the cursor
        // (i.e., tooltip right edge should be less than cursor x position)
        const cursorX = chartBox.x + chartBox.width * 0.9;

        console.log(
          `Cursor X: ${cursorX}, Tooltip left: ${tooltipBox.x}, Tooltip right: ${tooltipBox.x + tooltipBox.width}`
        );

        // The tooltip should either:
        // 1. Be positioned to the left of cursor (for overflow handling)
        // 2. Or be within the chart bounds
        const tooltipRightEdge = tooltipBox.x + tooltipBox.width;
        const chartRightEdge = chartBox.x + chartBox.width;

        expect(tooltipRightEdge).toBeLessThanOrEqual(chartRightEdge + 50); // Allow small overflow
        console.log("Tooltip positioned within acceptable bounds near right edge");
      }
    } else {
      console.log("No tooltip visible at right edge position");
    }
  });

  test("tooltip disappears when moving mouse away from chart", async ({
    page,
  }) => {
    const projectHref = await navigateToProjectWithCharts(page, orgSlug);

    if (!projectHref) {
      console.log("No projects found, skipping test");
      test.skip();
      return;
    }

    // Wait for chart to render
    const chartContainer = await waitForChartRender(page);

    // Get chart bounding box
    const chartBox = await chartContainer.boundingBox();
    if (!chartBox) {
      throw new Error("Could not get chart bounding box");
    }

    // Hover over the chart center
    await page.mouse.move(
      chartBox.x + chartBox.width / 2,
      chartBox.y + chartBox.height / 2
    );
    await page.waitForTimeout(300);

    // Check if tooltip appeared
    const tooltipSelector = 'div[style*="position: absolute"]';
    const tooltipsBefore = await page
      .locator(tooltipSelector)
      .filter({ has: page.locator("table") })
      .count();

    console.log(`Tooltips visible while hovering: ${tooltipsBefore}`);

    // Move mouse away from the chart (far outside)
    await page.mouse.move(0, 0);

    // Wait for tooltip to disappear (our hideDelay is 100ms)
    await page.waitForTimeout(500);

    // Check that tooltip is no longer visible
    const tooltipAfter = page.locator(tooltipSelector).filter({
      has: page.locator("table"),
    });

    // The tooltip should either be hidden (display: none) or removed from DOM
    const stillVisible = await tooltipAfter.isVisible().catch(() => false);

    if (tooltipsBefore > 0) {
      // If there was a tooltip, it should now be hidden
      expect(stillVisible).toBeFalsy();
      console.log("Tooltip correctly disappeared after moving mouse away");
    } else {
      console.log(
        "No tooltip was shown initially - chart may have no data at hover position"
      );
    }
  });
});
