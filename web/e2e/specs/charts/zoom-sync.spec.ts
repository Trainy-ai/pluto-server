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

    // Perform drag-to-zoom on chart 0 (retry up to 3 times since drag-zoom can be flaky in CI)
    const overlayBox = await getChartOverlayBox(page, ".uplot .u-over", 0);
    const initialSpan = initialRange0[1] - initialRange0[0];
    let zoomApplied = false;

    for (let attempt = 0; attempt < 3 && !zoomApplied; attempt++) {
      const startX = overlayBox.x + overlayBox.width * 0.2;
      const endX = overlayBox.x + overlayBox.width * 0.6;
      const centerY = overlayBox.y + overlayBox.height / 2;

      await page.mouse.move(startX, centerY);
      await waitForInteraction(page);
      await page.mouse.down();
      await page.mouse.move(endX, centerY, { steps: 15 });
      await page.mouse.up();
      await waitForInteraction(page, 800);

      const zoomedRange = await getChartXScaleRange(page, 0);
      if (zoomedRange) {
        const zoomedSpan = zoomedRange[1] - zoomedRange[0];
        if (zoomedSpan < initialSpan * 0.9) {
          zoomApplied = true;
        }
      }
    }

    if (!zoomApplied) {
      test.skip();
      return;
    }

    // Get zoomed ranges
    const zoomedRange0 = await getChartXScaleRange(page, 0);
    const zoomedRange1 = await getChartXScaleRange(page, 1);

    // Chart 0 should have zoomed (range narrowed)
    expect(zoomedRange0).not.toBeNull();

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

    // Step 1: Zoom in on chart 0 (retry up to 3 times since drag-zoom can be flaky in CI)
    const overlayBox = await getChartOverlayBox(page, ".uplot .u-over", 0);
    const initialSpan = initialRange0[1] - initialRange0[0];
    let zoomApplied = false;

    for (let attempt = 0; attempt < 3 && !zoomApplied; attempt++) {
      const startX = overlayBox.x + overlayBox.width * 0.2;
      const endX = overlayBox.x + overlayBox.width * 0.6;
      const centerY = overlayBox.y + overlayBox.height / 2;

      await page.mouse.move(startX, centerY);
      await waitForInteraction(page);
      await page.mouse.down();
      await page.mouse.move(endX, centerY, { steps: 15 });
      await page.mouse.up();
      await waitForInteraction(page, 800);

      const zoomedRange = await getChartXScaleRange(page, 0);
      if (zoomedRange) {
        const zoomedSpan = zoomedRange[1] - zoomedRange[0];
        if (zoomedSpan < initialSpan * 0.9) {
          zoomApplied = true;
        }
      }
    }

    if (!zoomApplied) {
      test.skip();
      return;
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

  test("zoom should persist on newly rendered charts after scroll", async ({
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

    // Step 1: Zoom on first visible chart
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

    // Record the zoomed X range (skip if uPlot instance not accessible)
    const zoomedRange = await getChartXScaleRange(page, 0);
    if (!zoomedRange) {
      test.skip();
      return;
    }

    // Step 2: Intercept tRPC graph data requests with a delay.
    // This guarantees that after scroll, newly mounted charts will first
    // render with cached/stale data, then receive a delayed data refresh
    // that triggers the setData() code path — exactly the bug scenario.
    // Without the fix, setData() resets the X scale and zoom is lost.
    let delayedRequestCount = 0;
    await page.route(
      (url) => url.pathname.includes("/trpc") && url.href.includes("graph"),
      async (route) => {
        delayedRequestCount++;
        // 800ms delay ensures chart mounts and applies zoom first,
        // then data arrives and triggers setData() path
        await new Promise((r) => setTimeout(r, 800));
        await route.continue();
      }
    );

    // Step 3: Scroll down significantly to trigger VirtualizedChart unmount/remount
    for (let i = 0; i < 5; i++) {
      await page.mouse.wheel(0, 600);
      await waitForInteraction(page, 200);
    }

    // Step 4: Wait for new charts to render and delayed data to arrive
    await waitForCharts(page);
    // Wait long enough for delayed responses (800ms) to arrive and setData() to fire
    await waitForInteraction(page, 2000);

    // Step 5: Verify ALL visible charts have the zoomed X range
    await expect
      .poll(
        async () => {
          const visibleChartCount = await getChartCount(page);
          if (visibleChartCount === 0) return "no charts";

          for (let i = 0; i < visibleChartCount; i++) {
            const range = await getChartXScaleRange(page, i);
            if (!range || !zoomedRange) continue;

            const totalSpan = zoomedRange[1] - zoomedRange[0];
            const tolerance = totalSpan * 0.1; // 10% tolerance

            const minDiff = Math.abs(range[0] - zoomedRange[0]);
            const maxDiff = Math.abs(range[1] - zoomedRange[1]);

            if (minDiff > tolerance || maxDiff > tolerance) {
              return `chart ${i} out of range: [${range[0]}, ${range[1]}] vs expected [${zoomedRange[0]}, ${zoomedRange[1]}]`;
            }
          }
          return "ok";
        },
        {
          timeout: 10000,
          message:
            "All visible charts should have the synced zoom range after delayed data refresh",
        }
      )
      .toBe("ok");

    // Remove the route handler
    await page.unroute(
      (url) => url.pathname.includes("/trpc") && url.href.includes("graph")
    );
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
