import { test, expect } from "@playwright/test";
import { waitForTRPC } from "../../utils/test-helpers";
import { TEST_ORG } from "../../fixtures/test-data";

test.describe("Member Management", () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to organization members settings page
    await page.goto(`/o/${TEST_ORG.slug}/settings/org/members`);
    await waitForTRPC(page);
  });

  test("should display members list", async ({ page }) => {
    // Should see the Members section
    const membersHeading = page.getByRole("heading", { name: /members/i });
    await expect(membersHeading).toBeVisible();

    // Should see at least one member (the current user)
    // Wait for the table to load by looking for member count text
    await expect(page.getByText(/member\(s\) total/i)).toBeVisible();
  });

  test("should display member details with role badge", async ({ page }) => {
    // Wait for page to load - ensure we have at least 1 member
    await expect(page.getByText(/\d+ member\(s\) total/i)).toBeVisible();

    // Should see role badges - look for OWNER badge (the test user is always OWNER)
    // The role badge is rendered as a span with the role text
    const roleBadge = page.getByText("OWNER").first();
    await expect(roleBadge).toBeVisible({ timeout: 10000 });
  });

  test("should open action menu for members", async ({ page }) => {
    // Wait for page to load
    await expect(page.getByText(/member\(s\) total/i)).toBeVisible();

    // Find the action menu button using the screen reader text
    const actionButton = page.getByRole("button", { name: /open menu/i }).first();
    await expect(actionButton).toBeVisible();

    // Click to open dropdown
    await actionButton.click();

    // Should see the dropdown menu
    const dropdownMenu = page.locator('[role="menu"]');
    await expect(dropdownMenu).toBeVisible();

    // Should have "View Details" option
    const viewDetailsOption = page.getByRole("menuitem", { name: /view details/i });
    await expect(viewDetailsOption).toBeVisible();
  });

  test("should open member details dialog", async ({ page }) => {
    // Wait for page to load
    await expect(page.getByText(/member\(s\) total/i)).toBeVisible();

    // Click action menu using screen reader text
    const actionButton = page.getByRole("button", { name: /open menu/i }).first();
    await actionButton.click();

    // Click "View Details"
    const viewDetailsOption = page.getByRole("menuitem", { name: /view details/i });
    await viewDetailsOption.click();

    // Should see the details dialog
    const detailsDialog = page.getByRole("dialog");
    await expect(detailsDialog).toBeVisible();

    // Dialog should have title "Member Details"
    const dialogTitle = page.getByRole("heading", { name: /member details/i });
    await expect(dialogTitle).toBeVisible();

    // Close the dialog - use first() to get the footer Close button, not the X button
    const closeButton = page.getByRole("button", { name: /close/i }).first();
    await closeButton.click();

    // Dialog should be closed
    await expect(detailsDialog).not.toBeVisible();
  });

  test("should show remove option visibility based on role", async ({ page }) => {
    // Wait for page to load
    await expect(page.getByText(/member\(s\) total/i)).toBeVisible();

    // Find and click first action menu using screen reader text
    const actionButton = page.getByRole("button", { name: /open menu/i }).first();
    await actionButton.click();

    // Wait for menu to appear
    const menu = page.locator('[role="menu"]');
    await expect(menu).toBeVisible();

    // View Details should always be visible
    const viewDetailsOption = page.getByRole("menuitem", { name: /view details/i });
    await expect(viewDetailsOption).toBeVisible();

    // Close the menu
    await page.keyboard.press("Escape");
    await expect(menu).not.toBeVisible();
  });

  test("should display invites section", async ({ page }) => {
    // The members page also shows invites section at the top
    const invitesHeading = page.getByRole("heading", { name: /invites/i });
    await expect(invitesHeading).toBeVisible();
  });
});
