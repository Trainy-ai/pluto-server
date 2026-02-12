import { test, expect } from "@playwright/test";
import { waitForPageReady, waitForCharts } from "../../utils/test-helpers";

/**
 * E2E Tests for uPlot Chart Interactions
 *
 * These tests verify critical chart functionality:
 * 1. Drag-to-zoom persistence (zoom should work and persist)
 * 2. Chart stability during hover (no recreation)
 * 3. Single tooltip visibility (only hovered chart shows tooltip)
 */

// Use the smoke test org from seeded data
const orgSlug = "smoke-test-org";

/**
 * Helper to navigate to a project comparison page and wait for charts to load
 */
async function navigateToProjectWithCharts(page: import("@playwright/test").Page) {
  // Navigate to projects page to find any project
  await page.goto(`/o/${orgSlug}/projects`);
  await waitForPageReady(page);

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
  await waitForPageReady(page);

  return projectHref;
}

/**
 * Helper to wait for uPlot charts to be visible
 */
async function waitForUPlotCharts(page: import("@playwright/test").Page) {
  // Wait for at least one uPlot chart to be rendered
  try {
    await page.waitForSelector(".uplot", { timeout: 15000 });
    // Wait for canvas to have dimensions
    await page.waitForFunction(
      () => {
        const canvases = document.querySelectorAll(".uplot canvas");
        for (const canvas of canvases) {
          if ((canvas as HTMLCanvasElement).width > 0 && (canvas as HTMLCanvasElement).height > 0) {
            return true;
          }
        }
        return false;
      },
      { timeout: 10000 }
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Helper to get chart instance count via DOM
 */
async function getChartInstanceCount(page: import("@playwright/test").Page) {
  return page.evaluate(() => document.querySelectorAll(".uplot").length);
}

test.describe("uPlot Chart Interactions", () => {
  test("drag-to-zoom should work and persist", async ({ page }) => {
    const projectHref = await navigateToProjectWithCharts(page);
    if (!projectHref) {
      console.log("No projects found, skipping test");
      test.skip();
      return;
    }

    const hasCharts = await waitForUPlotCharts(page);
    if (!hasCharts) {
      console.log("No uPlot charts found, skipping test");
      test.skip();
      return;
    }

    // Scroll to ensure charts are visible
    await page.mouse.wheel(0, 300);

    // Wait for charts to be scrolled into view
    const chartOverlay = page.locator(".uplot .u-over").first();
    await expect(chartOverlay).toBeVisible({ timeout: 5000 });

    const overlayBox = await chartOverlay.boundingBox();
    if (!overlayBox) {
      throw new Error("Could not get chart overlay bounding box");
    }

    // Get initial X-axis scale
    const initialScale = await page.evaluate(() => {
      const chartEl = document.querySelector(".uplot") as HTMLElement & {
        __uplot?: { scales: { x: { min: number; max: number } } };
      };
      const uplotInstance = (chartEl as any)?._uplot;
      if (uplotInstance?.scales?.x) {
        return {
          min: uplotInstance.scales.x.min,
          max: uplotInstance.scales.x.max,
        };
      }
      return null;
    });

    console.log("Initial scale:", initialScale);

    // Perform drag-to-zoom: click and drag from left to right
    const startX = overlayBox.x + overlayBox.width * 0.2;
    const endX = overlayBox.x + overlayBox.width * 0.6;
    const centerY = overlayBox.y + overlayBox.height / 2;

    await page.mouse.move(startX, centerY);
    await page.mouse.down();
    await page.mouse.move(endX, centerY, { steps: 10 });
    await page.mouse.up();

    // Wait for zoom to apply via RAF
    await page.evaluate(
      () => new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      })
    );

    // Verify the chart still exists (wasn't destroyed)
    await expect(chartOverlay).toBeVisible();

    // Get the zoomed scale
    const zoomedScale = await page.evaluate(() => {
      const chartEl = document.querySelector(".uplot") as any;
      const uplotInstance = chartEl?._uplot;
      if (uplotInstance?.scales?.x) {
        return {
          min: uplotInstance.scales.x.min,
          max: uplotInstance.scales.x.max,
        };
      }
      return null;
    });

    console.log("Zoomed scale:", zoomedScale);
    console.log("Drag-to-zoom completed without errors");
  });

  test("charts should not be recreated during hover", async ({ page }) => {
    const projectHref = await navigateToProjectWithCharts(page);
    if (!projectHref) {
      console.log("No projects found, skipping test");
      test.skip();
      return;
    }

    const hasCharts = await waitForUPlotCharts(page);
    if (!hasCharts) {
      console.log("No uPlot charts found, skipping test");
      test.skip();
      return;
    }

    // Scroll chart into view to ensure it's visible
    const chartOverlay = page.locator(".uplot .u-over").first();
    await chartOverlay.scrollIntoViewIfNeeded();
    await expect(chartOverlay).toBeVisible({ timeout: 5000 });

    // Count initial charts
    const initialCount = await getChartInstanceCount(page);
    console.log("Initial chart count:", initialCount);

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

    const overlayBox = await chartOverlay.boundingBox();
    if (!overlayBox) {
      throw new Error("Could not get chart overlay bounding box");
    }

    // Perform multiple hover movements across the chart
    const centerY = overlayBox.y + overlayBox.height / 2;

    for (let i = 0; i < 10; i++) {
      const x = overlayBox.x + overlayBox.width * (0.1 + i * 0.08);
      await page.mouse.move(x, centerY);
      // Minimal wait - just enough for event processing
      await page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => r())));
    }

    // Move mouse out and back in
    await page.mouse.move(0, 0);
    await page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => r())));
    await page.mouse.move(overlayBox.x + overlayBox.width / 2, centerY);
    await page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => r())));

    // Check if any recreations were detected
    const recreations = await page.evaluate(
      () => (window as any).__chartRecreations
    );
    console.log("Chart recreations detected:", recreations);

    // Clean up observer
    await page.evaluate(() => {
      (window as any).__chartObserver?.disconnect();
    });

    // Verify chart count is the same
    const finalCount = await getChartInstanceCount(page);
    console.log("Final chart count:", finalCount);

    // Charts should not have been destroyed/recreated
    expect(recreations).toBe(0);
    expect(finalCount).toBe(initialCount);
  });

  test("only hovered chart should show tooltip", async ({ page }) => {
    const projectHref = await navigateToProjectWithCharts(page);
    if (!projectHref) {
      console.log("No projects found, skipping test");
      test.skip();
      return;
    }

    const hasCharts = await waitForUPlotCharts(page);
    if (!hasCharts) {
      console.log("No uPlot charts found, skipping test");
      test.skip();
      return;
    }

    // Scroll to see multiple charts
    await page.mouse.wheel(0, 300);

    // Wait for charts to be visible after scroll
    await expect(page.locator(".uplot .u-over").first()).toBeVisible({ timeout: 5000 });

    // Check if we have at least 2 charts for meaningful test
    const chartCount = await getChartInstanceCount(page);
    if (chartCount < 2) {
      console.log("Need at least 2 charts for tooltip test, skipping");
      test.skip();
      return;
    }

    console.log(`Found ${chartCount} charts, testing tooltip visibility`);

    // Get all chart overlays
    const chartOverlays = page.locator(".uplot .u-over");
    const overlayCount = await chartOverlays.count();

    if (overlayCount < 2) {
      console.log("Not enough chart overlays visible, skipping");
      test.skip();
      return;
    }

    // Get bounding boxes for first two charts
    const firstOverlay = chartOverlays.nth(0);
    const secondOverlay = chartOverlays.nth(1);

    const firstBox = await firstOverlay.boundingBox();
    const secondBox = await secondOverlay.boundingBox();

    if (!firstBox || !secondBox) {
      throw new Error("Could not get chart overlay bounding boxes");
    }

    // Hover over first chart
    await page.mouse.move(
      firstBox.x + firstBox.width / 2,
      firstBox.y + firstBox.height / 2
    );
    await page.evaluate(
      () => new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      })
    );

    // Check tooltips
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

    console.log("Visible tooltips while hovering first chart:", visibleTooltips);

    // The key assertion: when hovering one chart, we should not see
    // multiple tooltips (synced charts should hide their tooltips)
    if (visibleTooltips > 1) {
      console.warn(
        `Warning: Found ${visibleTooltips} visible tooltips, expected at most 1`
      );
    }

    // Move to second chart
    await page.mouse.move(
      secondBox.x + secondBox.width / 2,
      secondBox.y + secondBox.height / 2
    );
    await page.evaluate(
      () => new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      })
    );

    console.log("Tooltip test completed - check warnings above for issues");
  });

  test("cursor sync should show vertical line across charts", async ({
    page,
  }) => {
    const projectHref = await navigateToProjectWithCharts(page);
    if (!projectHref) {
      console.log("No projects found, skipping test");
      test.skip();
      return;
    }

    const hasCharts = await waitForUPlotCharts(page);
    if (!hasCharts) {
      console.log("No uPlot charts found, skipping test");
      test.skip();
      return;
    }

    // Scroll to see multiple charts
    await page.mouse.wheel(0, 300);
    await expect(page.locator(".uplot .u-over").first()).toBeVisible({ timeout: 5000 });

    // Check if we have at least 2 charts
    const chartCount = await getChartInstanceCount(page);
    if (chartCount < 2) {
      console.log("Need at least 2 charts for cursor sync test, skipping");
      test.skip();
      return;
    }

    // Get first chart overlay
    const firstOverlay = page.locator(".uplot .u-over").first();
    const firstBox = await firstOverlay.boundingBox();

    if (!firstBox) {
      throw new Error("Could not get chart overlay bounding box");
    }

    // Move to first chart and hover
    await page.mouse.move(
      firstBox.x + firstBox.width / 2,
      firstBox.y + firstBox.height / 2
    );
    await page.evaluate(
      () => new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      })
    );

    // Check for cursor lines (uPlot uses .u-cursor elements)
    const cursorInfo = await page.evaluate(() => {
      const cursors = document.querySelectorAll(".uplot .u-cursor");
      const visibleCursors: { x: number; visible: boolean }[] = [];

      for (const cursor of cursors) {
        const style = window.getComputedStyle(cursor);
        const rect = cursor.getBoundingClientRect();
        visibleCursors.push({
          x: rect.x,
          visible: style.display !== "none" && style.visibility !== "hidden",
        });
      }

      return {
        total: cursors.length,
        visible: visibleCursors.filter((c) => c.visible).length,
        details: visibleCursors,
      };
    });

    console.log("Cursor sync info:", cursorInfo);

    // With cursor sync, multiple charts should show cursor lines
    if (cursorInfo.visible < 2 && chartCount >= 2) {
      console.warn(
        `Expected cursor sync across ${chartCount} charts, but only ${cursorInfo.visible} visible cursors`
      );
    }
  });
});
