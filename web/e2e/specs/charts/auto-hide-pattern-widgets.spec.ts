import { test, expect } from "@playwright/test";
import { TEST_ORG, TEST_PROJECT } from "../../fixtures/test-data";
import {
  waitForPageReady,
  getServerUrl,
  getSessionCookie,
} from "../../utils/test-helpers";

/**
 * E2E Tests for Auto-Hide Empty Pattern Widgets
 *
 * Verifies that pattern-only chart widgets (glob/regex) that resolve to zero
 * metrics are automatically hidden in view mode, and shown again in edit mode.
 *
 * Depends on the "Auto-Hide Test" dashboard view seeded in setup.ts (step 7).
 */

const orgSlug = TEST_ORG.slug;
const projectName = TEST_PROJECT.name;

/** Locator helpers */
function sectionByName(page: import("@playwright/test").Page, name: string) {
  return page.locator(
    `[data-testid="dashboard-section"][data-section-name="${name}"]`
  );
}

function widgetsInSection(
  page: import("@playwright/test").Page,
  name: string
) {
  return sectionByName(page, name).locator(
    '[data-testid="dashboard-widget"]'
  );
}

test.describe("Auto-Hide Empty Pattern Widgets", () => {
  let viewId: string;

  test.beforeAll(async ({ browser }) => {
    // Fetch the "Auto-Hide Test" view ID via tRPC
    const context = await browser.newContext({
      storageState: "e2e/.auth/user.json",
    });
    const page = await context.newPage();

    // Navigate to the project to set up the session context (active org)
    await page.goto(`/o/${orgSlug}/projects/${projectName}`);
    await waitForPageReady(page);

    const serverUrl = getServerUrl();
    const sessionCookie = await getSessionCookie(page);
    if (!sessionCookie) {
      throw new Error("No session cookie found");
    }

    const cookieHeader = `${sessionCookie.name}=${sessionCookie.value}`;

    // Get organizationId from the auth endpoint
    const authUrl = `${serverUrl}/trpc/auth?batch=1&input=${encodeURIComponent(
      JSON.stringify({ "0": { json: null } })
    )}`;
    const authResponse = await page.request.get(authUrl, {
      headers: { Cookie: cookieHeader },
    });
    const authData = await authResponse.json();
    const organizationId =
      authData[0]?.result?.data?.json?.activeOrganization?.id;
    if (!organizationId) {
      throw new Error("Could not get organizationId from auth endpoint");
    }

    // Fetch dashboard views list
    const input = encodeURIComponent(
      JSON.stringify({
        "0": { json: { organizationId, projectName } },
      })
    );
    const response = await page.request.get(
      `${serverUrl}/trpc/dashboardViews.list?batch=1&input=${input}`,
      {
        headers: { Cookie: cookieHeader },
      }
    );

    const body = await response.json();
    const views = body[0]?.result?.data?.json?.views;
    const autoHideView = views?.find(
      (v: { name: string }) => v.name === "Auto-Hide Test"
    );

    if (!autoHideView) {
      throw new Error(
        'Dashboard view "Auto-Hide Test" not found. Run test setup first.'
      );
    }

    viewId = autoHideView.id;
    await context.close();
  });

  test("hides pattern-only widgets that match no metrics in view mode", async ({
    page,
  }) => {
    // Navigate directly to the seeded dashboard view
    await page.goto(
      `/o/${orgSlug}/projects/${projectName}?chart=${viewId}`
    );
    await waitForPageReady(page);

    // Wait for the hook to settle — sections that match should become visible
    await expect(sectionByName(page, "Matching Patterns")).toBeVisible({
      timeout: 30000,
    });
    await expect(sectionByName(page, "Literal Metrics")).toBeVisible();
    await expect(sectionByName(page, "Mixed")).toBeVisible();

    // "Non-Matching Patterns" should be absent from the DOM
    // (all 4 widgets are pattern-only and none match seeded data)
    await expect(sectionByName(page, "Non-Matching Patterns")).toBeHidden();

    // Verify visible widget counts per section
    await expect(widgetsInSection(page, "Matching Patterns")).toHaveCount(3);
    await expect(widgetsInSection(page, "Literal Metrics")).toHaveCount(2);
    await expect(widgetsInSection(page, "Mixed")).toHaveCount(2);

    // Total visible widgets: 3 + 2 + 2 = 7
    const totalWidgets = await page
      .locator('[data-testid="dashboard-widget"]')
      .count();
    expect(totalWidgets).toBe(7);
  });

  test("shows all widgets including non-matching patterns in edit mode", async ({
    page,
  }) => {
    await page.goto(
      `/o/${orgSlug}/projects/${projectName}?chart=${viewId}`
    );
    await waitForPageReady(page);

    // Wait for view mode to settle
    await expect(sectionByName(page, "Matching Patterns")).toBeVisible({
      timeout: 30000,
    });
    await expect(sectionByName(page, "Non-Matching Patterns")).toBeHidden();

    // Enter edit mode
    const editBtn = page.locator('[data-testid="edit-dashboard-btn"]');
    await expect(editBtn).toBeVisible();
    await editBtn.click();

    // All 4 sections should now be visible
    await expect(sectionByName(page, "Matching Patterns")).toBeVisible();
    await expect(sectionByName(page, "Non-Matching Patterns")).toBeVisible({
      timeout: 10000,
    });
    await expect(sectionByName(page, "Literal Metrics")).toBeVisible();
    await expect(sectionByName(page, "Mixed")).toBeVisible();

    // All 11 widgets should be visible
    const totalWidgets = await page
      .locator('[data-testid="dashboard-widget"]')
      .count();
    expect(totalWidgets).toBe(11);

    // Non-matching section should show its 4 widgets
    await expect(
      widgetsInSection(page, "Non-Matching Patterns")
    ).toHaveCount(4);
  });

  test("toggles section visibility between view and edit mode", async ({
    page,
  }) => {
    await page.goto(
      `/o/${orgSlug}/projects/${projectName}?chart=${viewId}`
    );
    await waitForPageReady(page);

    // View mode: "Non-Matching Patterns" hidden
    await expect(sectionByName(page, "Matching Patterns")).toBeVisible({
      timeout: 30000,
    });
    await expect(sectionByName(page, "Non-Matching Patterns")).toBeHidden();

    // Enter edit mode → section appears
    const editBtn = page.locator('[data-testid="edit-dashboard-btn"]');
    await editBtn.click();
    await expect(sectionByName(page, "Non-Matching Patterns")).toBeVisible({
      timeout: 10000,
    });

    // Cancel edit mode. react-grid-layout fires onLayoutChange on mount,
    // which may mark the config as changed. If a confirmation dialog
    // appears, click "Discard Changes" to exit edit mode.
    const cancelBtn = page.getByRole("button", { name: "Cancel" });
    await cancelBtn.click();

    const discardBtn = page.getByRole("button", { name: "Discard Changes" });
    const hasDialog = await discardBtn.isVisible({ timeout: 2000 }).catch(() => false);
    if (hasDialog) {
      await discardBtn.click();
    }

    // Back to view mode: non-matching section should be hidden again
    await expect(sectionByName(page, "Non-Matching Patterns")).toBeHidden({
      timeout: 15000,
    });
    await expect(sectionByName(page, "Matching Patterns")).toBeVisible();
  });
});
