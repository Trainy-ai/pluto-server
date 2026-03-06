import { test, expect } from "@playwright/test";
import { authSelectors } from "../../utils/selectors";

// Google OAuth tests need to run without authentication to test the sign-in flow
test.use({ storageState: { cookies: [], origins: [] } });

test.describe("Google OAuth Sign-In", () => {
  /**
   * User Prompt:
   * - write a stably test for our google auth login flow
   */
  test("should display Google sign-in button on the sign-in page", async ({
    page,
  }) => {
    // Navigate to sign-in page
    await page.goto("/auth/sign-in");

    // Verify the Google OAuth button is visible
    const googleButton = page.getByRole("button", {
      name: authSelectors.googleButton,
    });
    await expect(googleButton).toBeVisible();

    // Verify the Google logo is present inside the button
    const googleLogo = googleButton.locator('img[alt="Google"]');
    await expect(googleLogo).toBeVisible();
    await expect(googleLogo).toHaveAttribute(
      "src",
      "/assets/logos/google-logo.svg",
    );
  });

  /**
   * User Prompt:
   * - write a stably test for our google auth login flow
   */
  test("should redirect to Google OAuth when clicking Google button", async ({
    page,
  }) => {
    // Navigate to sign-in page
    await page.goto("/auth/sign-in");

    // Click the Google sign-in button
    const googleButton = page.getByRole("button", {
      name: authSelectors.googleButton,
    });
    await googleButton.click();

    // Wait for redirect to Google's OAuth domain
    await page.waitForURL(/accounts\.google\.com/, { timeout: 15000 });

    // Verify we landed on Google's OAuth page with the client_id parameter
    const url = page.url();
    expect(url).toContain("accounts.google.com");
    expect(url).toContain("client_id");
  });

  /**
   * User Prompt:
   * - write a stably test for our google auth login flow
   */
  test("should handle navigation back from Google OAuth gracefully", async ({
    page,
  }) => {
    // Navigate to sign-in page
    await page.goto("/auth/sign-in");

    // Click the Google sign-in button
    const googleButton = page.getByRole("button", {
      name: authSelectors.googleButton,
    });
    await googleButton.click();

    // Wait for redirect to Google OAuth
    await page.waitForURL(/accounts\.google\.com/, { timeout: 15000 });

    // Simulate user canceling by navigating back
    await page.goBack();

    // Should be back on the sign-in page
    await expect(page).toHaveURL(/\/auth\/sign-in/);

    // Verify sign-in page is still functional — Google button is visible again
    await expect(
      page.getByRole("button", { name: authSelectors.googleButton }),
    ).toBeVisible();
  });
});
