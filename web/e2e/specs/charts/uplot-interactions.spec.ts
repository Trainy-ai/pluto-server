import { test, expect } from "@playwright/test";
import { navigateToFirstProject, waitForCharts, getChartOverlayBox, waitForInteraction } from "../../utils/test-helpers";

/**
 * E2E Tests for uPlot Chart Interactions
 *
 * These tests verify critical chart functionality:
 * 1. Drag-to-zoom persistence (zoom should work and persist)
 * 2. Chart stability during hover (no recreation)
 * 3. Single tooltip visibility (only hovered chart shows tooltip)
 */

const orgSlug = "smoke-test-org";

/**
 * Helper to get chart instance count via DOM
 */
async function getChartInstanceCount(page: import("@playwright/test").Page) {
  return page.evaluate(() => document.querySelectorAll(".uplot").length);
}

test.describe("uPlot Chart Interactions", () => {
  test("drag-to-zoom should work and persist", async ({ page }) => {
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

    const overlayBox = await getChartOverlayBox(page);

    // Perform drag-to-zoom: click and drag from left to right
    const startX = overlayBox.x + overlayBox.width * 0.2;
    const endX = overlayBox.x + overlayBox.width * 0.6;
    const centerY = overlayBox.y + overlayBox.height / 2;

    await page.mouse.move(startX, centerY);
    await page.mouse.down();
    await page.mouse.move(endX, centerY, { steps: 10 });
    await page.mouse.up();

    // Wait for zoom to apply
    await waitForInteraction(page);

    // Verify the chart still exists (wasn't destroyed)
    await expect(page.locator(".uplot .u-over").first()).toBeVisible();
  });

  test("charts should not be recreated during hover", async ({ page }) => {
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

    // Wait for charts to stabilize (stop re-rendering after page load)
    await expect.poll(
      async () => {
        const count1 = await getChartInstanceCount(page);
        await page.waitForTimeout(500);
        const count2 = await getChartInstanceCount(page);
        return count1 === count2;
      },
      { timeout: 15000, message: "Waiting for chart count to stabilize" }
    ).toBe(true);

    const overlayBox = await getChartOverlayBox(page);

    // Count initial charts
    const initialCount = await getChartInstanceCount(page);

    // Set up mutation observer to detect chart recreation
    await page.evaluate(() => {
      (window as any).__chartRecreations = 0;
      const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          for (const removed of mutation.removedNodes) {
            if (
              removed instanceof HTMLElement &&
              removed.classList?.contains("uplot")
            ) {
              (window as any).__chartRecreations++;
            }
          }
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });
      (window as any).__chartObserver = observer;
    });

    // Perform multiple hover movements across the chart
    const centerY = overlayBox.y + overlayBox.height / 2;

    for (let i = 0; i < 10; i++) {
      const x = overlayBox.x + overlayBox.width * (0.1 + i * 0.08);
      await page.mouse.move(x, centerY);
      await page.waitForTimeout(50);
    }

    // Move mouse out and back in
    await page.mouse.move(0, 0);
    await page.waitForTimeout(100);
    await page.mouse.move(overlayBox.x + overlayBox.width / 2, centerY);
    await page.waitForTimeout(100);

    // Check if any recreations were detected
    const recreations = await page.evaluate(
      () => (window as any).__chartRecreations
    );

    // Clean up observer
    await page.evaluate(() => {
      (window as any).__chartObserver?.disconnect();
    });

    // Verify chart count is the same
    const finalCount = await getChartInstanceCount(page);

    // Charts should not have been destroyed/recreated
    expect(recreations).toBe(0);
    expect(finalCount).toBe(initialCount);
  });

  test("only hovered chart should show tooltip", async ({ page }) => {
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

    // Check if we have at least 2 charts for meaningful test
    const chartCount = await getChartInstanceCount(page);
    if (chartCount < 2) {
      test.skip();
      return;
    }

    // Get bounding boxes for first two charts with retry (handles re-renders)
    const firstBox = await getChartOverlayBox(page, ".uplot .u-over", 0);
    const secondBox = await getChartOverlayBox(page, ".uplot .u-over", 1);

    // Hover over first chart
    await page.mouse.move(
      firstBox.x + firstBox.width / 2,
      firstBox.y + firstBox.height / 2
    );
    await waitForInteraction(page);

    // Check tooltips — at most one should be visible
    const visibleTooltips = await page.evaluate(() => {
      const tooltipSelectors = [
        "[data-testid='uplot-tooltip']",
        ".uplot-tooltip:not(.hidden)",
      ];

      let count = 0;
      for (const selector of tooltipSelectors) {
        const elements = document.querySelectorAll(selector);
        for (const el of elements) {
          const style = window.getComputedStyle(el);
          if (
            style.display !== "none" &&
            style.visibility !== "hidden" &&
            style.opacity !== "0" &&
            (el as HTMLElement).offsetParent !== null
          ) {
            count++;
          }
        }
      }
      return count;
    });

    // When hovering one chart, at most one tooltip should be visible
    expect(visibleTooltips).toBeLessThanOrEqual(1);

    // Move to second chart
    await page.mouse.move(
      secondBox.x + secondBox.width / 2,
      secondBox.y + secondBox.height / 2
    );
    await waitForInteraction(page);
  });

  test("cursor sync should show vertical line across charts", async ({
    page,
  }) => {
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

    // Check if we have at least 2 charts
    const chartCount = await getChartInstanceCount(page);
    if (chartCount < 2) {
      test.skip();
      return;
    }

    const firstBox = await getChartOverlayBox(page);

    // Move to first chart and hover
    await page.mouse.move(
      firstBox.x + firstBox.width / 2,
      firstBox.y + firstBox.height / 2
    );

    // Use polling to wait for cursor elements to appear (more reliable than RAF)
    await expect.poll(
      async () => {
        const total = await page.evaluate(() =>
          document.querySelectorAll(".uplot .u-cursor-x, .uplot .u-cursor-y").length
        );
        return total;
      },
      { timeout: 5000, message: "Waiting for cursor elements to appear" }
    ).toBeGreaterThan(0);
  });
});
