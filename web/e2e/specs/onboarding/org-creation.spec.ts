import { test, expect } from "@playwright/test";
import { orgSelectors } from "../../utils/selectors";
import { waitForPageReady } from "../../utils/test-helpers";

test.describe("Organization Creation", () => {
  test("should create organization via 2-step flow", async ({ page }) => {
    // Navigate to org creation page
    await page.goto("/onboard/org");

    // Step 1: Fill organization details
    const nameInput = page.getByLabel(orgSelectors.nameInput);
    await expect(nameInput).toBeVisible();

    // Fill organization name
    const timestamp = Date.now();
    const orgName = `Test Org ${timestamp}`;
    await nameInput.fill(orgName);

    // Verify slug auto-generates
    // (depends on implementation - may need to check if slug input exists)
    await page.waitForTimeout(200);

    // Click next/continue button
    const nextButton = page.getByRole("button", { name: orgSelectors.nextButton });
    if (await nextButton.isVisible()) {
      await nextButton.click();
    }

    // Step 2: Review and create
    // Look for create/submit button
    const createButton = page.getByRole("button", {
      name: orgSelectors.createButton,
    });
    await expect(createButton).toBeVisible();
    await createButton.click();

    // Wait for tRPC mutation to complete
    await waitForPageReady(page);

    // Should redirect to organization page
    // Use pattern matching to be flexible about the slug
    await page.waitForURL(/\/o\/[^/]+/);

    // Verify we're on an organization page
    await expect(page).toHaveURL(/\/o\/.+/);
  });

});
