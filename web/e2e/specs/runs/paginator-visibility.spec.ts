import { test, expect } from "@playwright/test";
import { TEST_ORG, TEST_PROJECT } from "../../fixtures/test-data";

test.describe("Paginator Visibility", () => {
  const orgSlug = TEST_ORG.slug;
  const projectName = TEST_PROJECT.name;

  test.beforeEach(async ({ page }) => {
    // Navigate to the project runs page
    await page.goto(`/o/${orgSlug}/projects/${projectName}`);
    await page.waitForLoadState("domcontentloaded");
  });

  test("paginator should be visible at small viewport height", async ({
    page,
  }) => {
    // Wait for the runs table to load
    await page.waitForSelector('[data-testid="runs-table"], table', {
      state: "visible",
      timeout: 15000,
    });

    // Resize viewport to simulate zoomed-in browser (small height)
    await page.setViewportSize({ width: 1280, height: 500 });

    // Find paginator elements - the page size dropdown and navigation buttons
    const pageSizeSelect = page.locator('button:has-text("15"), button:has-text("10"), button:has-text("20"), button:has-text("5")').first();
    const pageIndicator = page.locator('text=/\\d+\\s*\\/\\s*\\d+/').first();

    // Check that paginator elements are visible in the viewport
    // Playwright's toBeVisible() auto-waits for the element
    await expect(pageSizeSelect).toBeVisible({ timeout: 5000 });
    await expect(pageIndicator).toBeVisible({ timeout: 5000 });

    // Verify the paginator is within the visible viewport (not scrolled out)
    // The toBeVisible() checks above ensure bounding boxes are not null
    const pageSizeBox = await pageSizeSelect.boundingBox();
    const pageIndicatorBox = await pageIndicator.boundingBox();

    // Verify elements are within visible viewport (500px height)
    expect(pageSizeBox!.y + pageSizeBox!.height).toBeLessThan(500);
    expect(pageIndicatorBox!.y + pageIndicatorBox!.height).toBeLessThan(500);
  });

  test("paginator should be visible at narrow viewport width", async ({
    page,
  }) => {
    // Wait for the runs table to load
    await page.waitForSelector('[data-testid="runs-table"], table', {
      state: "visible",
      timeout: 15000,
    });

    // Resize viewport to narrow width (simulating zoomed-in or small screen)
    await page.setViewportSize({ width: 800, height: 600 });

    // Find paginator page indicator
    const pageIndicator = page.locator('text=/\\d+\\s*\\/\\s*\\d+/').first();

    // Check that paginator elements are still visible
    await expect(pageIndicator).toBeVisible({ timeout: 5000 });

    // Verify the page indicator is within the visible viewport
    // The toBeVisible() check above ensures the bounding box is not null
    const pageIndicatorBox = await pageIndicator.boundingBox();
    expect(pageIndicatorBox!.y + pageIndicatorBox!.height).toBeLessThan(600);
  });

  test("paginator should remain visible when table has many rows with tags", async ({
    page,
  }) => {
    // Wait for the runs table to load
    await page.waitForSelector('[data-testid="runs-table"], table', {
      state: "visible",
      timeout: 15000,
    });

    // Set a constrained viewport
    await page.setViewportSize({ width: 1280, height: 600 });

    // Find the page indicator (e.g., "1 / 10")
    const pageIndicator = page.locator('text=/\\d+\\s*\\/\\s*\\d+/').first();

    // Paginator should be visible without scrolling
    await expect(pageIndicator).toBeVisible({ timeout: 5000 });

    // Get the bounding box to verify it's within viewport
    // The toBeVisible() check above ensures the bounding box is not null
    const box = await pageIndicator.boundingBox();

    // The paginator should be fully visible within the 600px viewport height
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.y + box!.height).toBeLessThan(600);
  });
});
