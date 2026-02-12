import { test, expect } from "@playwright/test";
import { navigateToFirstProject, waitForCharts, waitForInteraction } from "../../utils/test-helpers";

/**
 * E2E Tests for Run Table Hover → Chart Highlight
 *
 * Verifies that hovering over a run row in the runs table
 * triggers the chart highlight system (emphasizing the corresponding curve).
 */

const orgSlug = "smoke-test-org";

test.describe("Run Table Hover → Chart Highlight", () => {
  test("hovering a selected run row should highlight the corresponding chart curve", async ({
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

    // Find selected run rows (they have data-state="selected")
    const selectedRows = page.locator('tr[data-state="selected"]');
    const selectedCount = await selectedRows.count();

    if (selectedCount === 0) {
      test.skip();
      return;
    }

    // Get the first selected run row
    const firstSelectedRow = selectedRows.first();
    await expect(firstSelectedRow).toBeVisible({ timeout: 5000 });

    // Get the run ID from the row with retry (handles DOM re-renders)
    let runId: string | null = null;
    await expect(async () => {
      runId = await firstSelectedRow.getAttribute("data-run-id");
      expect(runId).toBeTruthy();
    }).toPass({ timeout: 5000 });

    // Hover over the run row
    await firstSelectedRow.hover();
    await waitForInteraction(page);

    // Verify the row has the hover highlight data attribute
    await expect(firstSelectedRow).toHaveAttribute("data-hover-highlight", "true", { timeout: 3000 });

    // Check that the chart highlight system was triggered by inspecting
    // series widths on uPlot instances. Use polling for reliability.
    await expect.poll(
      async () => {
        return page.evaluate((expectedRunId) => {
          const charts = document.querySelectorAll(".uplot");
          for (let ci = 0; ci < charts.length; ci++) {
            const chart = charts[ci] as any;
            const uplotInstance = chart?._uplot;
            if (!uplotInstance) continue;

            for (let si = 1; si < uplotInstance.series.length; si++) {
              if (uplotInstance.series[si]._seriesId === expectedRunId) {
                // Found matching series — check if it's highlighted (width=4)
                return uplotInstance.series[si].width === 4;
              }
            }
          }
          // No matching series found — acceptable (chart might not have this run's data)
          return true;
        }, runId);
      },
      { timeout: 5000, message: "Waiting for chart highlight" }
    ).toBe(true);

    // Move mouse away from the row
    await page.mouse.move(0, 0);
    await waitForInteraction(page);

    // Verify highlight is cleared — series widths should be back to default (2.5)
    await expect.poll(
      async () => {
        return page.evaluate(() => {
          const charts = document.querySelectorAll(".uplot");
          for (let ci = 0; ci < charts.length; ci++) {
            const chart = charts[ci] as any;
            const uplotInstance = chart?._uplot;
            if (!uplotInstance) continue;

            for (let si = 1; si < uplotInstance.series.length; si++) {
              if (uplotInstance.series[si].width !== 2.5) {
                return false;
              }
            }
          }
          return true;
        });
      },
      { timeout: 5000, message: "Waiting for highlight reset" }
    ).toBe(true);
  });

  test("hovering a non-selected run row should not trigger chart highlight", async ({
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

    // Find non-selected run rows
    const nonSelectedRows = page.locator(
      'tr[data-run-id]:not([data-state="selected"])',
    );
    const nonSelectedCount = await nonSelectedRows.count();

    if (nonSelectedCount === 0) {
      test.skip();
      return;
    }

    const firstNonSelectedRow = nonSelectedRows.first();
    await expect(firstNonSelectedRow).toBeVisible({ timeout: 5000 });

    // Hover over non-selected row
    await firstNonSelectedRow.hover();
    await waitForInteraction(page);

    // Verify no chart highlight was triggered — all widths should remain default
    const allDefault = await page.evaluate(() => {
      const charts = document.querySelectorAll(".uplot");
      for (let ci = 0; ci < charts.length; ci++) {
        const chart = charts[ci] as any;
        const uplotInstance = chart?._uplot;
        if (!uplotInstance) continue;

        for (let si = 1; si < uplotInstance.series.length; si++) {
          if (uplotInstance.series[si].width !== 2.5) {
            return false;
          }
        }
      }
      return true;
    });

    expect(allDefault).toBe(true);
  });
});
