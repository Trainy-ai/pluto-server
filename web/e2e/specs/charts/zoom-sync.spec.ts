import { test, expect } from "@playwright/test";
import {
  navigateToFirstProject,
  waitForCharts,
  getChartOverlayBox,
  waitForInteraction,
} from "../../utils/test-helpers";

/**
 * E2E Tests for Chart Zoom Synchronization
 *
 * Verifies that zoom and reset operations propagate correctly across
 * all visible charts in the "All Metrics" view.
 */

const orgSlug = "smoke-test-org";

/**
 * Read X-axis scale range from a uPlot chart instance by index.
 * Returns [min, max] from the chart's scales.x, or null if unavailable.
 */
async function getChartXScaleRange(
  page: import("@playwright/test").Page,
  chartIndex: number
): Promise<[number, number] | null> {
  return page.evaluate((idx) => {
    const charts = document.querySelectorAll(".uplot");
    const chartEl = charts[idx];
    if (!chartEl) return null;
    // uPlot stores its instance on the root element
    const uplot = (chartEl as any)._uplot;
    if (!uplot?.scales?.x) return null;
    const { min, max } = uplot.scales.x;
    if (min == null || max == null) return null;
    return [min, max] as [number, number];
  }, chartIndex);
}

/**
 * Get the number of visible uPlot chart instances.
 */
async function getChartCount(page: import("@playwright/test").Page) {
  return page.evaluate(() => document.querySelectorAll(".uplot").length);
}

test.describe("Chart Zoom Synchronization", () => {
  test("drag-to-zoom should synchronize X-axis across visible charts", async ({
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

    // Need at least 2 charts
    const chartCount = await getChartCount(page);
    if (chartCount < 2) {
      test.skip();
      return;
    }

    // Record initial X ranges
    const initialRange0 = await getChartXScaleRange(page, 0);
    const initialRange1 = await getChartXScaleRange(page, 1);
    if (!initialRange0 || !initialRange1) {
      test.skip();
      return;
    }

    // Perform drag-to-zoom on chart 0
    const overlayBox = await getChartOverlayBox(page, ".uplot .u-over", 0);
    const startX = overlayBox.x + overlayBox.width * 0.2;
    const endX = overlayBox.x + overlayBox.width * 0.6;
    const centerY = overlayBox.y + overlayBox.height / 2;

    // Hover first to establish this as the active chart
    await page.mouse.move(startX, centerY);
    await waitForInteraction(page);

    await page.mouse.down();
    await page.mouse.move(endX, centerY, { steps: 10 });
    await page.mouse.up();

    // Wait for zoom to apply and propagate
    await waitForInteraction(page, 500);

    // Get zoomed ranges
    const zoomedRange0 = await getChartXScaleRange(page, 0);
    const zoomedRange1 = await getChartXScaleRange(page, 1);

    // Chart 0 should have zoomed (range narrowed)
    expect(zoomedRange0).not.toBeNull();
    if (zoomedRange0 && initialRange0) {
      const initialSpan = initialRange0[1] - initialRange0[0];
      const zoomedSpan = zoomedRange0[1] - zoomedRange0[0];
      expect(zoomedSpan).toBeLessThan(initialSpan * 0.9); // At least 10% narrower
    }

    // Chart 1 should have the same X range as chart 0 (within tolerance)
    expect(zoomedRange1).not.toBeNull();
    if (zoomedRange0 && zoomedRange1) {
      const totalSpan = zoomedRange0[1] - zoomedRange0[0];
      const tolerance = totalSpan * 0.05; // 5% tolerance
      expect(Math.abs(zoomedRange1[0] - zoomedRange0[0])).toBeLessThan(
        tolerance
      );
      expect(Math.abs(zoomedRange1[1] - zoomedRange0[1])).toBeLessThan(
        tolerance
      );
    }
  });

  test("double-click reset should synchronize across all charts", async ({
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

    const chartCount = await getChartCount(page);
    if (chartCount < 2) {
      test.skip();
      return;
    }

    // Record initial X ranges (before zoom)
    const initialRange0 = await getChartXScaleRange(page, 0);
    const initialRange1 = await getChartXScaleRange(page, 1);
    if (!initialRange0 || !initialRange1) {
      test.skip();
      return;
    }

    // Step 1: Zoom in on chart 0
    const overlayBox = await getChartOverlayBox(page, ".uplot .u-over", 0);
    const startX = overlayBox.x + overlayBox.width * 0.2;
    const endX = overlayBox.x + overlayBox.width * 0.6;
    const centerY = overlayBox.y + overlayBox.height / 2;

    await page.mouse.move(startX, centerY);
    await waitForInteraction(page);
    await page.mouse.down();
    await page.mouse.move(endX, centerY, { steps: 10 });
    await page.mouse.up();
    await waitForInteraction(page, 500);

    // Verify zoom was applied
    const zoomedRange0 = await getChartXScaleRange(page, 0);
    expect(zoomedRange0).not.toBeNull();
    if (zoomedRange0 && initialRange0) {
      const zoomedSpan = zoomedRange0[1] - zoomedRange0[0];
      const initialSpan = initialRange0[1] - initialRange0[0];
      expect(zoomedSpan).toBeLessThan(initialSpan * 0.9);
    }

    // Step 2: Double-click to reset zoom on chart 0
    const resetX = overlayBox.x + overlayBox.width / 2;
    const resetY = overlayBox.y + overlayBox.height / 2;
    await page.mouse.dblclick(resetX, resetY);
    await waitForInteraction(page, 500);

    // Step 3: Both charts should show the same (full) X range
    const resetRange0 = await getChartXScaleRange(page, 0);
    const resetRange1 = await getChartXScaleRange(page, 1);

    expect(resetRange0).not.toBeNull();
    expect(resetRange1).not.toBeNull();

    if (resetRange0 && resetRange1) {
      const totalSpan = resetRange0[1] - resetRange0[0];
      const tolerance = totalSpan * 0.05;
      expect(Math.abs(resetRange1[0] - resetRange0[0])).toBeLessThan(
        tolerance
      );
      expect(Math.abs(resetRange1[1] - resetRange0[1])).toBeLessThan(
        tolerance
      );
    }
  });

  test("no spurious zoom broadcast during scroll", async ({ page }) => {
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

    const chartCount = await getChartCount(page);
    if (chartCount < 2) {
      test.skip();
      return;
    }

    // Record initial X ranges
    const initialRange0 = await getChartXScaleRange(page, 0);
    const initialRange1 = await getChartXScaleRange(page, 1);
    if (!initialRange0 || !initialRange1) {
      test.skip();
      return;
    }

    // Scroll down and back up (no zoom interaction)
    await page.mouse.wheel(0, 500);
    await waitForInteraction(page, 300);
    await page.mouse.wheel(0, -500);
    await waitForInteraction(page, 300);

    // Charts should still show the same X range
    const afterRange0 = await getChartXScaleRange(page, 0);
    const afterRange1 = await getChartXScaleRange(page, 1);

    if (afterRange0 && initialRange0) {
      const totalSpan = initialRange0[1] - initialRange0[0];
      const tolerance = totalSpan * 0.05;
      expect(Math.abs(afterRange0[0] - initialRange0[0])).toBeLessThan(
        tolerance
      );
      expect(Math.abs(afterRange0[1] - initialRange0[1])).toBeLessThan(
        tolerance
      );
    }

    if (afterRange1 && initialRange1) {
      const totalSpan = initialRange1[1] - initialRange1[0];
      const tolerance = totalSpan * 0.05;
      expect(Math.abs(afterRange1[0] - initialRange1[0])).toBeLessThan(
        tolerance
      );
      expect(Math.abs(afterRange1[1] - initialRange1[1])).toBeLessThan(
        tolerance
      );
    }
  });
});
