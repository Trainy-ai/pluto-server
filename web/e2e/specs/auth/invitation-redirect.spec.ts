import { test, expect } from "@playwright/test";

// These tests run without authentication to test unauthenticated user flows
test.use({ storageState: { cookies: [], origins: [] } });

test.describe("Invitation Link Redirect", () => {
  /**
   * When an unauthenticated user clicks an invitation link from email,
   * they should be redirected to sign-in, not see an error.
   *
   * This tests the fix for the race condition in /o route's beforeLoad
   * where myInvites query was running in parallel with auth check.
   */
  const testCases = [
    { name: "base /o route", path: "/o" },
    { name: "invitation link with query param", path: "/o?invite=pending" },
  ];

  for (const { name, path } of testCases) {
    test(`should redirect to sign-in without errors for ${name}`, async ({
      page,
    }) => {
      // Set up listener for console errors before navigation
      const errors: string[] = [];
      page.on("pageerror", (error) => {
        errors.push(error.message);
      });

      // Navigate to the path
      await page.goto(path);

      // Should redirect to sign-in page
      await expect(page).toHaveURL(/\/auth\/sign-in/, { timeout: 10000 });

      // Should not have any TRPC unauthorized errors
      const trpcErrors = errors.filter(
        (e) => e.includes("UNAUTHORIZED") || e.includes("TRPCClientError")
      );
      expect(trpcErrors).toHaveLength(0);
    });
  }
});
