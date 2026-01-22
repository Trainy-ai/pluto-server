import { test as setup, expect } from "@playwright/test";

// Dev user credentials (from seed-dev.ts)
const DEV_EMAIL = "dev@example.com";
const DEV_PASSWORD = "devpassword123";

const authFile = "e2e/.auth/perf-user.json";

setup("authenticate for performance tests", async ({ page }) => {
  // Go to sign-in page
  await page.goto("/auth/sign-in");
  await page.waitForLoadState("networkidle");

  // Fill login form with dev credentials
  await page.getByRole("textbox", { name: /email/i }).fill(DEV_EMAIL);
  await page.getByRole("textbox", { name: /password/i }).fill(DEV_PASSWORD);
  await page.getByRole("button", { name: /sign in/i }).click();

  // Wait for successful redirect
  await page.waitForURL(/\/(dashboard|projects|o)/, { timeout: 15000 });

  // Verify we're logged in
  await expect(page).not.toHaveURL(/sign-in/);

  // Save auth state
  await page.context().storageState({ path: authFile });
});
