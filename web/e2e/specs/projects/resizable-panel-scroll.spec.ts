import { test, expect } from "@playwright/test";
import { waitForTRPC } from "../../utils/test-helpers";

/**
 * Navigate to a specific project comparison page
 */
async function navigateToProjectComparison(
  page: import("@playwright/test").Page,
  orgSlug: string,
  projectName: string
) {
  await page.goto(`/o/${orgSlug}/projects/${projectName}`);
  await waitForTRPC(page);
}

test.describe("Resizable Panel Scroll", () => {
  // Use the smoke test org from seeded data
  const orgSlug = "smoke-test-org";

  test("should allow vertical scrolling in metrics display panel", async ({ page }) => {
    // First navigate to projects page to find any project
    await page.goto(`/o/${orgSlug}/projects`);
    await waitForTRPC(page);

    // Find the first project link
    const firstProjectLink = page.locator('a[href*="/projects/"]').first();
    const projectHref = await firstProjectLink.getAttribute('href', { timeout: 5000 }).catch(() => null);

    // If no project exists, skip this test
    if (!projectHref) {
      console.log("No projects found in organization, skipping test");
      test.skip();
      return;
    }

    // Navigate to the project comparison page
    await page.goto(projectHref);
    await waitForTRPC(page);

    // Wait for the page to fully load with metrics
    await page.waitForLoadState("networkidle");

    // Find the metrics display container (has overflow-y-auto and flex-1 classes)
    const metricsContainer = page.locator(".overflow-y-auto.flex-1");
    await expect(metricsContainer).toBeVisible({ timeout: 10000 });

    // Get scroll properties
    const scrollInfo = await metricsContainer.evaluate((el) => ({
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
      scrollTop: el.scrollTop,
      hasScroll: el.scrollHeight > el.clientHeight,
    }));

    console.log("Metrics container scroll info:", scrollInfo);

    // Only test scrolling if the content is scrollable
    if (scrollInfo.hasScroll) {
      // Verify initial scroll position is at top
      expect(scrollInfo.scrollTop).toBe(0);

      // Scroll down 200px
      await metricsContainer.evaluate((el) => {
        el.scrollTop = 200;
      });

      // Wait a bit for scroll to take effect
      await page.waitForTimeout(100);

      // Verify scroll position changed
      const newScrollTop = await metricsContainer.evaluate((el) => el.scrollTop);
      expect(newScrollTop).toBeGreaterThan(0);
      console.log(`Successfully scrolled from ${scrollInfo.scrollTop} to ${newScrollTop}px`);

      // Scroll to bottom
      const maxScroll = scrollInfo.scrollHeight - scrollInfo.clientHeight;
      await metricsContainer.evaluate((el, max) => {
        el.scrollTop = max;
      }, maxScroll);

      await page.waitForTimeout(100);

      // Verify we reached the bottom
      const bottomScrollTop = await metricsContainer.evaluate((el) => el.scrollTop);
      expect(bottomScrollTop).toBeGreaterThanOrEqual(maxScroll - 10); // Allow 10px tolerance
      console.log(`Scrolled to bottom: ${bottomScrollTop}px (max: ${maxScroll}px)`);

      // Scroll back to top
      await metricsContainer.evaluate((el) => {
        el.scrollTop = 0;
      });

      await page.waitForTimeout(100);

      const topScrollTop = await metricsContainer.evaluate((el) => el.scrollTop);
      expect(topScrollTop).toBe(0);
      console.log("Successfully scrolled back to top");
    } else {
      console.log("Content fits in viewport, no scroll needed");
      // This is acceptable - just verify the container has overflow-y-auto
      const overflowY = await metricsContainer.evaluate(
        (el) => window.getComputedStyle(el).overflowY
      );
      expect(overflowY).toBe("auto");
    }
  });

  test("should maintain scroll functionality when resizing panels", async ({ page }) => {
    // First navigate to projects page to find any project
    await page.goto(`/o/${orgSlug}/projects`);
    await waitForTRPC(page);

    // Find the first project link
    const firstProjectLink = page.locator('a[href*="/projects/"]').first();
    const projectHref = await firstProjectLink.getAttribute('href', { timeout: 5000 }).catch(() => null);

    // If no project exists, skip this test
    if (!projectHref) {
      console.log("No projects found in organization, skipping test");
      test.skip();
      return;
    }

    // Navigate to the project comparison page
    await page.goto(projectHref);
    await waitForTRPC(page);
    await page.waitForLoadState("networkidle");

    // Find the resizable handle between panels
    // The handle is rendered with a specific structure: a separator with a grip icon inside
    const resizeHandle = page.locator('[data-resize-handle-id]').or(
      page.locator('[role="separator"]')
    ).first();
    await expect(resizeHandle).toBeVisible({ timeout: 5000 });

    // Get initial handle position
    const handleBox = await resizeHandle.boundingBox();
    if (!handleBox) {
      throw new Error("Could not get resize handle bounding box");
    }

    // Drag the handle to the right to make runs panel larger
    await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(handleBox.x + 200, handleBox.y + handleBox.height / 2);
    await page.mouse.up();

    // Wait for resize to complete
    await page.waitForTimeout(500);

    // Verify metrics container still has correct scroll setup
    const metricsContainer = page.locator(".overflow-y-auto.flex-1");
    const scrollInfo = await metricsContainer.evaluate((el) => ({
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
      overflowY: window.getComputedStyle(el).overflowY,
      hasScroll: el.scrollHeight > el.clientHeight,
    }));

    console.log("Scroll info after resize:", scrollInfo);

    // Verify overflow-y is still auto
    expect(scrollInfo.overflowY).toBe("auto");

    // If content is scrollable, verify scrolling still works
    if (scrollInfo.hasScroll) {
      await metricsContainer.evaluate((el) => {
        el.scrollTop = 100;
      });

      await page.waitForTimeout(100);

      const scrollTop = await metricsContainer.evaluate((el) => el.scrollTop);
      expect(scrollTop).toBeGreaterThan(0);
      console.log("Scrolling still works after panel resize");
    }
  });

  test("should have flex layout on metrics container wrapper", async ({ page }) => {
    // First navigate to projects page to find any project
    await page.goto(`/o/${orgSlug}/projects`);
    await waitForTRPC(page);

    // Find the first project link
    const firstProjectLink = page.locator('a[href*="/projects/"]').first();
    const projectHref = await firstProjectLink.getAttribute('href', { timeout: 5000 }).catch(() => null);

    // If no project exists, skip this test
    if (!projectHref) {
      console.log("No projects found in organization, skipping test");
      test.skip();
      return;
    }

    // Navigate to the project comparison page
    await page.goto(projectHref);
    await waitForTRPC(page);
    await page.waitForLoadState("networkidle");

    // Find the metrics display container
    const metricsContainer = page.locator(".overflow-y-auto.flex-1");
    await expect(metricsContainer).toBeVisible({ timeout: 10000 });

    // Get the parent element's classes by evaluating within the metrics container context
    const parentClasses = await metricsContainer.evaluate((el) => {
      if (!el.parentElement) return [];
      return Array.from(el.parentElement.classList);
    });

    console.log("Parent element classes:", parentClasses);

    // Check for flex layout classes
    expect(parentClasses).toContain("flex");
    expect(parentClasses).toContain("flex-col");
    expect(parentClasses).toContain("h-full");

    // Verify computed styles
    const parentStyles = await metricsContainer.evaluate((el) => {
      if (!el.parentElement) return {};
      const computed = window.getComputedStyle(el.parentElement);
      return {
        display: computed.display,
        flexDirection: computed.flexDirection,
        height: computed.height,
      };
    });

    console.log("Parent computed styles:", parentStyles);

    expect(parentStyles.display).toBe("flex");
    expect(parentStyles.flexDirection).toBe("column");
  });
});
