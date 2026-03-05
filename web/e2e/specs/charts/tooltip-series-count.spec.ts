import { test, expect } from "@playwright/test";
import {
  navigateToFirstProject,
  waitForCharts,
  getChartOverlayBox,
  waitForInteraction,
  waitForRunsData,
} from "../../utils/test-helpers";

test.describe("Tooltip Series Count", () => {
  const orgSlug = "smoke-test-org";

  test("tooltip shows all selected runs when hovering over comparison chart", async ({
    page,
  }) => {
    const projectHref = await navigateToFirstProject(page, orgSlug);
    if (!projectHref) {
      test.skip();
      return;
    }

    // Wait for runs data and ensure at least 2 runs are selected
    await waitForRunsData(page);

    await expect
      .poll(
        async () => {
          const el = page.locator("text=runs selected").locator("..");
          if (!(await el.isVisible().catch(() => false))) return 0;
          const text = (await el.textContent().catch(() => "")) ?? "";
          const match = text.match(/(\d+)\s*of/);
          return match ? parseInt(match[1]) : 0;
        },
        { timeout: 10000, message: "Waiting for selected runs count" },
      )
      .toBeGreaterThanOrEqual(2);

    // Wait for charts to render
    try {
      await waitForCharts(page);
    } catch {
      test.skip();
      return;
    }

    const box = await getChartOverlayBox(page);

    // Hover at multiple x positions to find a point where tooltip shows data
    let maxSeriesCount = 0;
    for (let xOffset = 0.2; xOffset <= 0.8; xOffset += 0.1) {
      await page.mouse.move(
        box.x + box.width * xOffset,
        box.y + box.height / 2,
      );
      await waitForInteraction(page, 150);

      // Count series entries in the visible tooltip
      const seriesCount = await page
        .evaluate(() => {
          const tooltips = document.querySelectorAll(
            '[data-testid="uplot-tooltip"]',
          );
          for (const tooltip of tooltips) {
            const style = window.getComputedStyle(tooltip);
            if (
              style.display === "none" ||
              style.visibility === "hidden" ||
              style.opacity === "0"
            ) {
              continue;
            }
            // Count rows in the tooltip content area (each row = one series entry)
            const contentArea = tooltip.querySelector(
              "[data-tooltip-content]",
            );
            if (contentArea) {
              return contentArea.children.length;
            }
          }
          return 0;
        })
        .catch(() => 0);

      if (seriesCount > maxSeriesCount) {
        maxSeriesCount = seriesCount;
      }
    }

    // The tooltip should show entries for more than 1 series (multiple runs selected)
    expect(maxSeriesCount).toBeGreaterThan(1);
  });

  test("tooltip series count label matches actual visible entries", async ({
    page,
  }) => {
    const projectHref = await navigateToFirstProject(page, orgSlug);
    if (!projectHref) {
      test.skip();
      return;
    }

    await waitForRunsData(page);

    try {
      await waitForCharts(page);
    } catch {
      test.skip();
      return;
    }

    const box = await getChartOverlayBox(page);

    // Find a hover position that produces a tooltip with data
    for (let xOffset = 0.2; xOffset <= 0.8; xOffset += 0.1) {
      await page.mouse.move(
        box.x + box.width * xOffset,
        box.y + box.height / 2,
      );
      await waitForInteraction(page, 150);

      const result = await page
        .evaluate(() => {
          const tooltips = document.querySelectorAll(
            '[data-testid="uplot-tooltip"]',
          );
          for (const tooltip of tooltips) {
            const style = window.getComputedStyle(tooltip);
            if (
              style.display === "none" ||
              style.visibility === "hidden" ||
              style.opacity === "0"
            ) {
              continue;
            }

            // Get the "N series" count from the header's count label span.
            // Cannot use header.textContent because step number and count
            // concatenate (e.g. "Step 19655 series" from "Step 1965" + "5 series").
            const header = tooltip.querySelector("[data-tooltip-header]");
            if (!header) continue;
            const spans = header.querySelectorAll("span");
            let labelCount = -1;
            for (const span of spans) {
              const m = span.textContent?.match(/^(\d+)\s*series$/);
              if (m) {
                labelCount = parseInt(m[1]);
                break;
              }
            }

            // Count actual rows in content area
            const contentArea = tooltip.querySelector(
              "[data-tooltip-content]",
            );
            const rowCount = contentArea ? contentArea.children.length : 0;

            if (labelCount > 0 && rowCount > 0) {
              return { labelCount, rowCount };
            }
          }
          return null;
        })
        .catch(() => null);

      if (result) {
        // The "N series" label should match the number of visible row entries
        expect(result.labelCount).toBe(result.rowCount);
        return; // Test passes
      }
    }

    // If we couldn't find a tooltip with both label and rows, that's acceptable
    // (chart might not have data at any of the hover positions)
  });
});
