import { test, expect } from "@playwright/test";
import { TEST_ORG, TEST_PROJECT } from "../../fixtures/test-data";

test.describe("URL Auto-Resolution to User's Org", () => {
  // Set the active organization before each test by visiting the org page.
  // The catch-all route relies on the session's activeOrganizationId,
  // which is only set after navigating to an org-scoped page.
  test.beforeEach(async ({ page }) => {
    // Use networkidle to ensure the server-side session update (activeOrganizationId)
    // completes before navigating away. domcontentloaded fires too early - before
    // TanStack Router's async beforeLoad hook finishes the org activation API call.
    await page.goto(`/o/${TEST_ORG.slug}`, { waitUntil: "networkidle" });
  });

  test("should redirect /projects/:name to /o/:orgSlug/projects/:name for authenticated users", async ({
    page,
  }) => {
    // Navigate to a project URL without the org prefix
    await page.goto(`/projects/${TEST_PROJECT.name}`);

    // Should redirect to the same path under the user's active org
    await expect(page).toHaveURL(
      new RegExp(`/o/${TEST_ORG.slug}/projects/${TEST_PROJECT.name}`),
      { timeout: 10000 }
    );
  });

  test("should preserve search params during redirect", async ({ page }) => {
    // Navigate with search params
    await page.goto(`/projects/${TEST_PROJECT.name}?view=custom`);

    // Should redirect and preserve the search param
    await expect(page).toHaveURL(
      new RegExp(`/o/${TEST_ORG.slug}/projects/${TEST_PROJECT.name}.*view=custom`),
      { timeout: 10000 }
    );
  });
});

test.describe("URL Auto-Resolution - Unauthenticated", () => {
  // Run without authentication
  test.use({ storageState: { cookies: [], origins: [] } });

  test("should redirect unauthenticated users to sign-in", async ({
    page,
  }) => {
    await page.goto(`/projects/${TEST_PROJECT.name}`);

    // Unauthenticated users should be sent to sign-in
    await expect(page).toHaveURL(/\/auth\/sign-in/, { timeout: 10000 });
  });
});
