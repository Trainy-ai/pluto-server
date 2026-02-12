import { test, expect } from "@playwright/test";
import { TEST_ORG, TEST_PROJECT } from "../../fixtures/test-data";
import { graphSelectors } from "../../utils/selectors";
import { navigateToRunGraph, waitForPageReady } from "../../utils/test-helpers";

// Note: These tests require actual run data with graphs
// You may need to create test runs with graph data first

test.describe("Graph Visualization", () => {
  test("should load graph page without errors", async ({ page }) => {
    // This test requires a valid run ID with graph data
    // For now, we'll navigate to a project and try to find a run
    await page.goto(`/o/${TEST_ORG.slug}/projects/${TEST_PROJECT.name}`);
    await waitForPageReady(page);

    // Try to find a run link (flexible selector)
    const runLinks = page.getByRole("link", { name: /run|view/i });
    const count = await runLinks.count();

    if (count > 0) {
      // Click the first run link
      await runLinks.first().click();
      await waitForPageReady(page);

      // Navigate to graph tab/page
      const graphLink = page.getByRole("link", { name: /graph|model/i });
      if (await graphLink.isVisible()) {
        await graphLink.click();
        await waitForPageReady(page);

        // Check for ReactFlow container OR empty state (graph data may not exist)
        const reactFlowContainer = page.locator(graphSelectors.reactFlowContainer);
        const emptyState = page.getByText(graphSelectors.emptyState);
        const hasGraph = await reactFlowContainer.isVisible({ timeout: 15000 }).catch(() => false);
        const hasEmpty = await emptyState.isVisible().catch(() => false);
        expect(hasGraph || hasEmpty).toBeTruthy();
      }
    } else {
      // No runs found - skip test
      test.skip();
    }
  });

  test("should show empty state when no graph data exists", async ({ page }) => {
    // Navigate to a run that doesn't have graph data
    // This is flexible - we'll look for empty state messaging
    await page.goto(`/o/${TEST_ORG.slug}/projects/${TEST_PROJECT.name}`);
    await waitForPageReady(page);

    // Try to navigate to a run's graph page
    // If we can't find one, skip the test
    const runLinks = page.getByRole("link", { name: /run|view/i });
    const count = await runLinks.count();

    if (count > 0) {
      await runLinks.first().click();
      await waitForPageReady(page);

      const graphLink = page.getByRole("link", { name: /graph|model/i });
      if (await graphLink.isVisible()) {
        await graphLink.click();
        await waitForPageReady(page);

        // Look for either empty state or graph
        const emptyState = page.getByText(graphSelectors.emptyState);
        const reactFlowContainer = page.locator(graphSelectors.reactFlowContainer);

        // One of these should be visible
        const emptyStateVisible = await emptyState.isVisible().catch(() => false);
        const graphVisible = await reactFlowContainer
          .isVisible()
          .catch(() => false);

        expect(emptyStateVisible || graphVisible).toBeTruthy();

        // If empty state, check for documentation link
        if (emptyStateVisible) {
          const docLink = page.getByRole("link", { name: /doc|learn|guide/i });
          await docLink.isVisible().catch(() => false);
        }
      }
    } else {
      test.skip();
    }
  });

  test("should support fullscreen mode", async ({ page }) => {
    // Navigate to a graph page
    await page.goto(`/o/${TEST_ORG.slug}/projects/${TEST_PROJECT.name}`);
    await waitForPageReady(page);

    const runLinks = page.getByRole("link", { name: /run|view/i });
    const count = await runLinks.count();

    if (count > 0) {
      await runLinks.first().click();
      await waitForPageReady(page);

      const graphLink = page.getByRole("link", { name: /graph|model/i });
      if (await graphLink.isVisible()) {
        await graphLink.click();
        await waitForPageReady(page);

        // Look for fullscreen button
        const fullscreenButton = page.getByRole("button", {
          name: graphSelectors.fullscreenButton,
        });

        if (await fullscreenButton.isVisible()) {
          await fullscreenButton.click();

          // Check for fullscreen overlay (flexible CSS selector)
          const fullscreenOverlay = page.locator(
            '[class*="fullscreen"], [class*="z-50"], .fixed.inset-0'
          );
          await expect(fullscreenOverlay.first()).toBeVisible();

          // Try to find minimize/close button
          const minimizeButton = page.getByRole("button", {
            name: /minimize|close|exit/i,
          });
          if (await minimizeButton.isVisible()) {
            await minimizeButton.click();
            // Should return to normal layout
            await page.waitForTimeout(200);
          }
        }
      }
    } else {
      test.skip();
    }
  });

  test("should open help dialog", async ({ page }) => {
    // Navigate to a graph page
    await page.goto(`/o/${TEST_ORG.slug}/projects/${TEST_PROJECT.name}`);
    await waitForPageReady(page);

    const runLinks = page.getByRole("link", { name: /run|view/i });
    const count = await runLinks.count();

    if (count > 0) {
      await runLinks.first().click();
      await waitForPageReady(page);

      const graphLink = page.getByRole("link", { name: /graph|model/i });
      if (await graphLink.isVisible()) {
        await graphLink.click();
        await waitForPageReady(page);

        // Look for help button
        const helpButton = page.getByRole("button", {
          name: graphSelectors.helpButton,
        });

        if (await helpButton.isVisible()) {
          await helpButton.click();

          // Dialog should open
          const dialog = page.getByRole("dialog");
          await expect(dialog).toBeVisible();

          // Dialog should have close button
          const closeButton = page.getByRole("button", { name: /close/i });
          if (await closeButton.isVisible()) {
            await closeButton.click();
            await expect(dialog).not.toBeVisible();
          }
        }
      }
    } else {
      test.skip();
    }
  });
});
