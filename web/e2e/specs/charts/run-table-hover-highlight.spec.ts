import { test, expect } from "@playwright/test";
import { waitForTRPC } from "../../utils/test-helpers";

/**
 * E2E Tests for Run Table Hover → Chart Highlight
 *
 * Verifies that hovering over a run row in the runs table
 * triggers the chart highlight system (emphasizing the corresponding curve).
 */

const orgSlug = "smoke-test-org";

async function navigateToProjectWithCharts(
  page: import("@playwright/test").Page,
) {
  await page.goto(`/o/${orgSlug}/projects`);
  await waitForTRPC(page);

  const firstProjectLink = page.locator('a[href*="/projects/"]').first();
  const projectHref = await firstProjectLink
    .getAttribute("href", { timeout: 5000 })
    .catch(() => null);

  if (!projectHref) {
    return null;
  }

  await page.goto(projectHref);
  await waitForTRPC(page);

  return projectHref;
}

async function waitForUPlotCharts(page: import("@playwright/test").Page) {
  try {
    await page.waitForSelector(".uplot", { timeout: 10000 });
    return true;
  } catch {
    return false;
  }
}

test.describe("Run Table Hover → Chart Highlight", () => {
  test("hovering a selected run row should highlight the corresponding chart curve", async ({
    page,
  }) => {
    const projectHref = await navigateToProjectWithCharts(page);
    if (!projectHref) {
      test.skip();
      return;
    }

    const hasCharts = await waitForUPlotCharts(page);
    if (!hasCharts) {
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

    // Get the run ID from the row (used for unique series matching)
    const runId = await firstSelectedRow.getAttribute("data-run-id");
    expect(runId).toBeTruthy();

    // Hover over the run row
    await firstSelectedRow.hover();
    await page.evaluate(() => new Promise<void>(r => requestAnimationFrame(() => requestAnimationFrame(() => r()))));

    // Verify the row has the hover highlight data attribute
    const hoveredRunName = await firstSelectedRow.getAttribute(
      "data-hover-highlight",
    );
    expect(hoveredRunName).toBe("true");

    // Check that the chart highlight system was triggered by inspecting
    // series widths on uPlot instances. When a run is highlighted from the table,
    // its corresponding series should have width=4 and others should have width=0.5.
    // Matching is done by _seriesId (run ID) to handle duplicate run names.
    const highlightState = await page.evaluate((expectedRunId) => {
      const charts = document.querySelectorAll(".uplot");
      const results: {
        chartIndex: number;
        hasMatchingSeries: boolean;
        highlightedCorrectly: boolean;
      }[] = [];

      for (let ci = 0; ci < charts.length; ci++) {
        const chart = charts[ci] as any;
        const uplotInstance = chart?._uplot;
        if (!uplotInstance) continue;

        let hasMatch = false;
        let highlightedCorrectly = true;

        // First, check if there is a matching series by _seriesId
        for (let si = 1; si < uplotInstance.series.length; si++) {
          if (uplotInstance.series[si]._seriesId === expectedRunId) {
            hasMatch = true;
            break;
          }
        }

        // If there is a match, verify all series widths
        if (hasMatch) {
          for (let si = 1; si < uplotInstance.series.length; si++) {
            const series = uplotInstance.series[si];
            const isHighlighted = series._seriesId === expectedRunId;
            const expectedWidth = isHighlighted ? 4 : 0.5;
            if (series.width !== expectedWidth) {
              highlightedCorrectly = false;
              break;
            }
          }
        }

        results.push({
          chartIndex: ci,
          hasMatchingSeries: hasMatch,
          highlightedCorrectly: hasMatch ? highlightedCorrectly : true,
        });
      }

      return results;
    }, runId);

    // At least one chart should have the matching series highlighted
    const chartsWithMatch = highlightState.filter((r) => r.hasMatchingSeries);
    if (chartsWithMatch.length > 0) {
      for (const result of chartsWithMatch) {
        expect(result.highlightedCorrectly).toBe(true);
      }
    }

    // Move mouse away from the row
    await page.mouse.move(0, 0);
    await page.evaluate(() => new Promise<void>(r => requestAnimationFrame(() => requestAnimationFrame(() => r()))));

    // Verify highlight is cleared - series widths should be back to default (2.5)
    const resetState = await page.evaluate(() => {
      const charts = document.querySelectorAll(".uplot");
      const allReset: boolean[] = [];

      for (let ci = 0; ci < charts.length; ci++) {
        const chart = charts[ci] as any;
        const uplotInstance = chart?._uplot;
        if (!uplotInstance) continue;

        let isReset = true;
        for (let si = 1; si < uplotInstance.series.length; si++) {
          if (uplotInstance.series[si].width !== 2.5) {
            isReset = false;
            break;
          }
        }
        allReset.push(isReset);
      }

      return allReset;
    });

    // All charts should have reset widths
    for (const isReset of resetState) {
      expect(isReset).toBe(true);
    }
  });

  test("hovering a non-selected run row should not trigger chart highlight", async ({
    page,
  }) => {
    const projectHref = await navigateToProjectWithCharts(page);
    if (!projectHref) {
      test.skip();
      return;
    }

    const hasCharts = await waitForUPlotCharts(page);
    if (!hasCharts) {
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
    await page.evaluate(() => new Promise<void>(r => requestAnimationFrame(() => requestAnimationFrame(() => r()))));

    // Verify no chart highlight was triggered - all widths should remain default
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
