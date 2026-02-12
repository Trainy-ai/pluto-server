import { Page, expect } from "@playwright/test";

/**
 * Wait for the page to be ready after navigation or action.
 * Replaces the unreliable waitForLoadState("networkidle") pattern.
 *
 * Waits for:
 * 1. DOM content to be loaded
 * 2. Loading spinners to disappear
 */
export async function waitForPageReady(page: Page, timeout = 15000) {
  await page.waitForLoadState("domcontentloaded");
  // Wait for any loading indicators to disappear
  await page
    .locator('[data-loading="true"], .animate-spin')
    .first()
    .waitFor({ state: "hidden", timeout })
    .catch(() => {
      // No loading indicators found or they already disappeared
    });
}

/**
 * @deprecated Use waitForPageReady instead
 */
export async function waitForTRPC(page: Page) {
  await waitForPageReady(page);
}

/**
 * Wait for the runs table to be populated with rows.
 */
export async function waitForRunsTable(page: Page, timeout = 15000) {
  await page
    .locator('[aria-label="Toggle select row"]')
    .first()
    .waitFor({ state: "visible", timeout });
}

/**
 * Wait for uPlot charts to render with actual canvas content.
 */
export async function waitForCharts(page: Page, timeout = 30000) {
  // Wait for at least one uPlot render target with a canvas
  await page.waitForSelector(".uplot canvas", {
    state: "attached",
    timeout,
  });
  // Ensure canvas has non-zero dimensions (chart actually rendered)
  await page.waitForFunction(
    () => {
      const canvases = document.querySelectorAll(".uplot canvas");
      for (const canvas of canvases) {
        if (
          (canvas as HTMLCanvasElement).width > 0 &&
          (canvas as HTMLCanvasElement).height > 0
        ) {
          return true;
        }
      }
      return false;
    },
    { timeout }
  );
}

/**
 * Navigate to a specific organization page
 */
export async function navigateToOrg(page: Page, orgSlug: string) {
  await page.goto(`/o/${orgSlug}`);
  await waitForPageReady(page);
}

/**
 * Navigate to organization projects page
 */
export async function navigateToProjects(page: Page, orgSlug: string) {
  await page.goto(`/o/${orgSlug}/projects`);
  await waitForPageReady(page);
}

/**
 * Navigate to a specific run's graph page
 */
export async function navigateToRunGraph(
  page: Page,
  orgSlug: string,
  projectName: string,
  runId: string
) {
  await page.goto(`/o/${orgSlug}/projects/${projectName}/${runId}/graph`);
  await waitForPageReady(page);
}

/**
 * Check if user is authenticated
 * Looks for user menu/avatar or other auth indicators
 */
export async function assertAuthenticated(page: Page) {
  // Wait for the page to be on an authenticated route (not /auth/*)
  await expect(page).not.toHaveURL(/\/auth\//);
}

/**
 * Wait for element to be visible with custom timeout
 */
export async function waitForVisible(
  page: Page,
  selector: string,
  timeout = 10000
) {
  await page.locator(selector).waitFor({ state: "visible", timeout });
}

/**
 * Navigate to organization members settings page
 */
export async function navigateToMembersSettings(page: Page, orgSlug: string) {
  await page.goto(`/o/${orgSlug}/settings/org/members`);
  await waitForPageReady(page);
}
