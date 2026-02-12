import { Page, expect } from "@playwright/test";

/**
 * Wait for the page to be ready after navigation or action.
 *
 * Waits for:
 * 1. DOM content to be loaded
 * 2. At least one tRPC batch response to arrive (data is available)
 * 3. React to process the response (2 animation frames)
 * 4. Loading spinners to disappear
 */
export async function waitForPageReady(page: Page, timeout = 15000) {
  await page.waitForLoadState("domcontentloaded");

  // Wait for at least one tRPC batch response to arrive
  try {
    await page.waitForResponse(
      (resp) => resp.url().includes("/trpc/") && resp.status() === 200,
      { timeout: Math.min(timeout, 10000) }
    );
  } catch {
    // Not all pages make tRPC requests (auth pages, static pages)
  }

  // Give React 2 frames to process the response into DOM
  // Wrapped in try/catch because a navigation may destroy the execution context
  try {
    await page.evaluate(
      () =>
        new Promise<void>((r) =>
          requestAnimationFrame(() => requestAnimationFrame(() => r()))
        )
    );
  } catch {
    // Navigation occurred during the wait — page is already loading new content
  }

  // Then wait for any loading indicators to disappear
  await page
    .locator('[data-loading="true"], .animate-spin')
    .first()
    .waitFor({ state: "hidden", timeout: 5000 })
    .catch(() => {
      // No loading indicators found or they already disappeared
    });
}

/**
 * Wait for the page to be ready and for runs data to be loaded.
 * Use this in tests that read the runs selection counter.
 */
export async function waitForRunsData(page: Page, timeout = 15000) {
  await waitForPageReady(page, timeout);
  // Wait until the counter shows non-zero total (data has loaded)
  await expect
    .poll(
      async () => {
        const el = page.locator("text=runs selected").locator("..");
        if (!(await el.isVisible().catch(() => false))) return 0;
        const text = (await el.textContent().catch(() => "")) ?? "";
        const match = text.match(/of\s*(\d+)/);
        return match ? parseInt(match[1]) : 0;
      },
      { timeout, message: "Waiting for runs data to load (total > 0)" }
    )
    .toBeGreaterThan(0);
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
 * Get a chart overlay's bounding box with retry logic.
 * Charts can re-render and detach DOM elements between locate and action.
 * This retries the locate + scrollIntoView + boundingBox sequence.
 */
export async function getChartOverlayBox(
  page: Page,
  selector = ".uplot .u-over",
  index = 0,
  timeout = 10000
) {
  let box: { x: number; y: number; width: number; height: number } | null =
    null;
  await expect(async () => {
    const overlay = page.locator(selector).nth(index);
    await overlay.scrollIntoViewIfNeeded();
    await expect(overlay).toBeVisible();
    box = await overlay.boundingBox();
    expect(box).not.toBeNull();
  }).toPass({ timeout });
  return box!;
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

/**
 * Navigate to the first project in an organization.
 * Returns the project href, or null if no projects exist.
 */
export async function navigateToFirstProject(
  page: Page,
  orgSlug: string
): Promise<string | null> {
  await page.goto(`/o/${orgSlug}/projects`);
  await waitForPageReady(page);

  const firstProjectLink = page.locator('a[href*="/projects/"]').first();
  const projectHref = await firstProjectLink
    .getAttribute("href", { timeout: 5000 })
    .catch(() => null);

  if (!projectHref) {
    return null;
  }

  await page.goto(projectHref);
  await waitForPageReady(page);

  return projectHref;
}

/**
 * Get the server URL for direct API calls.
 * In Buildkite, the 'server' hostname is available via /etc/hosts.
 * In local dev, we use localhost:3001.
 */
export function getServerUrl(): string {
  const baseUrl = process.env.BASE_URL || "http://localhost:3000";
  if (baseUrl.match(/^https?:\/\/\d+\.\d+\.\d+\.\d+:/)) {
    return "http://server:3001";
  }
  return baseUrl.replace(":3000", ":3001");
}

/**
 * Extract the session cookie from the current browser context.
 * Returns the cookie object, or null if not found.
 */
export async function getSessionCookie(page: Page) {
  const cookies = await page.context().cookies();
  return (
    cookies.find((c) => c.name === "better-auth.session_token") ?? null
  );
}

/**
 * Wait for UI to settle after a mouse interaction (hover, click, drag).
 * Uses a short fixed delay instead of RAF, which is more reliable in CI
 * where requestAnimationFrame timing is unpredictable.
 */
export async function waitForInteraction(page: Page, ms = 200) {
  await page.waitForTimeout(ms);
}
