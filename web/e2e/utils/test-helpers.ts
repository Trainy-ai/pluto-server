import { Page, expect } from "@playwright/test";

/**
 * Wait for tRPC calls to complete
 * Useful after actions that trigger API calls
 */
export async function waitForTRPC(page: Page) {
  await page.waitForLoadState("networkidle");
}

/**
 * Navigate to a specific organization page
 */
export async function navigateToOrg(page: Page, orgSlug: string) {
  await page.goto(`/o/${orgSlug}`);
  await waitForTRPC(page);
}

/**
 * Navigate to organization projects page
 */
export async function navigateToProjects(page: Page, orgSlug: string) {
  await page.goto(`/o/${orgSlug}/projects`);
  await waitForTRPC(page);
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
  await waitForTRPC(page);
}

/**
 * Check if user is authenticated
 * Looks for user menu/avatar or other auth indicators
 */
export async function assertAuthenticated(page: Page) {
  // Wait for the page to be on an authenticated route (not /auth/*)
  await expect(page).not.toHaveURL(/\/auth\//);

  // Could also check for user menu/avatar if needed
  // await expect(page.getByRole('button', { name: /user menu/i })).toBeVisible();
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
