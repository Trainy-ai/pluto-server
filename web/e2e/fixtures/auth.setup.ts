import { test as setup, expect } from "@playwright/test";

const authFile = "e2e/.auth/user.json";

// Test user credentials - use the smoke test user with pre-seeded data
const TEST_EMAIL = "test-smoke@mlop.local";
const TEST_PASSWORD = "TestPassword123!";

/**
 * Authenticates via email/password and saves auth state for reuse across tests.
 * Falls back to creating a new account if sign-in fails.
 */
setup("authenticate via email/password", async ({ page }) => {
  // Navigate to sign-in page
  await page.goto("/auth/sign-in");
  await page.waitForLoadState("domcontentloaded");

  // Fill in email field
  const emailInput = page.getByRole("textbox", { name: /email/i });
  await expect(emailInput).toBeVisible({ timeout: 10000 });
  await emailInput.fill(TEST_EMAIL);

  // Fill in password field
  const passwordInput = page.getByRole("textbox", { name: /password/i });
  await passwordInput.fill(TEST_PASSWORD);

  // Click sign in button
  const signInButton = page.getByRole("button", { name: /sign in/i });
  await signInButton.click();

  // Wait for either successful redirect or error
  try {
    // Wait for redirect to dashboard, org page, or home page
    // The smoke test user has finished onboarding, so should go to org page
    await page.waitForURL(/\/(dashboard|projects|o)/, { timeout: 15000 });
    console.log("Sign in successful, redirected to:", page.url());
  } catch {
    console.log("Sign in may have failed, attempting to sign up...");

    // Navigate to sign-up page
    await page.goto("/auth/sign-up");
    await page.waitForLoadState("domcontentloaded");

    // Fill in sign-up form
    const signUpEmailInput = page.getByRole("textbox", { name: /email/i });
    await signUpEmailInput.fill(TEST_EMAIL);

    // Password field - use exact match to avoid confirm password
    const signUpPasswordInput = page.getByRole("textbox", { name: "Password", exact: true });
    await signUpPasswordInput.fill(TEST_PASSWORD);

    // Confirm password field
    const confirmPasswordInput = page.getByRole("textbox", { name: /confirm password/i });
    if (await confirmPasswordInput.isVisible({ timeout: 1000 }).catch(() => false)) {
      await confirmPasswordInput.fill(TEST_PASSWORD);
    }

    // Look for name input if present
    const nameInput = page.getByRole("textbox", { name: /name/i });
    if (await nameInput.isVisible({ timeout: 1000 }).catch(() => false)) {
      await nameInput.fill("Test User");
    }

    // Click sign up button
    const signUpButton = page.getByRole("button", { name: /sign up|create account/i });
    await signUpButton.click();

    // Wait for redirect after sign-up (could go to onboarding or dashboard)
    await page.waitForURL(/\/(dashboard|projects|onboard|o)/, { timeout: 15000 });
    console.log("Sign up successful, redirected to:", page.url());
  }

  // Wait for page to stabilize - use domcontentloaded instead of networkidle
  await page.waitForLoadState("domcontentloaded");

  // Save auth state
  await page.context().storageState({ path: authFile });
  console.log("Auth state saved successfully");
});
