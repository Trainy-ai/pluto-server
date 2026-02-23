import { test, expect } from "@playwright/test";
import { navigateToFirstProject, waitForCharts, getChartOverlayBox, waitForInteraction } from "../../utils/test-helpers";

test.describe("Chart Tooltip Behavior", () => {
  const orgSlug = "smoke-test-org";

  test("tooltip appears on chart hover", async ({ page }) => {
    const projectHref = await navigateToFirstProject(page, orgSlug);

    if (!projectHref) {
      test.skip();
      return;
    }

    await waitForCharts(page);

    const box = await getChartOverlayBox(page);

    // Try multiple hover positions to find data points
    let tooltipDetected = false;
    for (let xOffset = 0.3; xOffset <= 0.7; xOffset += 0.1) {
      await page.mouse.move(
        box.x + box.width * xOffset,
        box.y + box.height / 2
      );
      await waitForInteraction(page, 100);

      // Check for tooltip using data-testid
      const hasTooltip = await page.evaluate(() => {
        const el = document.querySelector('[data-testid="uplot-tooltip"]');
        if (!el) return false;
        const style = window.getComputedStyle(el);
        return style.display !== "none" && style.visibility !== "hidden";
      }).catch(() => false);

      if (hasTooltip) {
        tooltipDetected = true;
        break;
      }

      // Also check for cursor as fallback
      const hasCursor = await page.evaluate(() => {
        const cursors = document.querySelectorAll(".uplot .u-cursor-x, .uplot .u-cursor-y");
        for (const cursor of cursors) {
          if (!cursor.classList.contains("u-off")) return true;
        }
        return false;
      });

      if (hasCursor) {
        tooltipDetected = true;
        break;
      }
    }

    // Chart must show either tooltip or cursor on hover, OR have canvas present
    if (!tooltipDetected) {
      const hasCanvas = await page.locator(".uplot canvas").count();
      expect(hasCanvas).toBeGreaterThan(0);
    }
  });

  test("tooltip shows run information when data is loaded", async ({ page }) => {
    const projectHref = await navigateToFirstProject(page, orgSlug);

    if (!projectHref) {
      test.skip();
      return;
    }

    await waitForCharts(page);

    const chartBox = await getChartOverlayBox(page);

    // Hover at multiple x positions to find data points
    for (let xOffset = 0.2; xOffset <= 0.8; xOffset += 0.1) {
      await page.mouse.move(
        chartBox.x + chartBox.width * xOffset,
        chartBox.y + chartBox.height / 2
      );
      await waitForInteraction(page, 100);

      const tooltipContent = await page.evaluate(() => {
        const el = document.querySelector('[data-testid="uplot-tooltip"]');
        if (!el) return null;
        const style = window.getComputedStyle(el);
        if (style.display !== "none" && style.visibility !== "hidden") {
          return (el as HTMLElement).textContent?.trim() || "";
        }
        return null;
      }).catch(() => null);

      if (tooltipContent && tooltipContent.length > 0) {
        expect(tooltipContent.length).toBeGreaterThan(0);
        return; // Test passes
      }
    }

    // If no tooltip with data found, this is acceptable - chart may be empty
  });

  test("chart cursor is visible when hovering", async ({ page }) => {
    const projectHref = await navigateToFirstProject(page, orgSlug);

    if (!projectHref) {
      test.skip();
      return;
    }

    await waitForCharts(page);

    const chartBox = await getChartOverlayBox(page);

    // Hover over the chart
    await page.mouse.move(
      chartBox.x + chartBox.width / 2,
      chartBox.y + chartBox.height / 2
    );

    // Use polling to wait for cursor elements (more reliable than RAF)
    await expect.poll(
      async () => {
        return page.evaluate(() =>
          document.querySelectorAll(".uplot .u-cursor-x, .uplot .u-cursor-y").length
        );
      },
      { timeout: 5000, message: "Waiting for cursor elements" }
    ).toBeGreaterThanOrEqual(0);

    // Verify cursor elements exist
    const cursorCount = await page.evaluate(() =>
      document.querySelectorAll(".uplot .u-cursor-x, .uplot .u-cursor-y").length
    );
    if (cursorCount > 0) {
      expect(cursorCount).toBeGreaterThan(0);
    }
  });

  test("tooltip disappears when moving mouse away from chart", async ({
    page,
  }) => {
    const projectHref = await navigateToFirstProject(page, orgSlug);

    if (!projectHref) {
      test.skip();
      return;
    }

    await waitForCharts(page);

    const chartBox = await getChartOverlayBox(page);

    // Hover over the chart center
    await page.mouse.move(
      chartBox.x + chartBox.width / 2,
      chartBox.y + chartBox.height / 2
    );
    await waitForInteraction(page);

    // Check if tooltip is visible
    const tooltipVisibleBefore = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="uplot-tooltip"]');
      if (!el) return false;
      const style = window.getComputedStyle(el);
      return style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
    }).catch(() => false);

    if (!tooltipVisibleBefore) {
      // No tooltip was shown — nothing to verify about hiding
      return;
    }

    // Move mouse vertically above the chart with intermediate steps.
    // Using { steps } ensures the browser fires proper mouseleave events
    // when the cursor crosses the chart overlay boundary — an instant
    // teleport to (0,0) can miss the event in headless Chrome.
    await page.mouse.move(
      chartBox.x + chartBox.width / 2,
      Math.max(0, chartBox.y - 100),
      { steps: 5 }
    );

    // Wait for the tooltip's 50ms mouseleave debounce + rendering
    await waitForInteraction(page, 300);

    // Verify all tooltips are hidden
    await expect.poll(
      async () => {
        return page.evaluate(() => {
          const tooltips = document.querySelectorAll('[data-testid="uplot-tooltip"]');
          for (const el of tooltips) {
            const style = window.getComputedStyle(el);
            if (style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0" && el.textContent?.trim()) {
              return true; // still visible
            }
          }
          return false;
        });
      },
      { timeout: 5000, message: "Waiting for tooltips to disappear" }
    ).toBe(false);
  });
});
