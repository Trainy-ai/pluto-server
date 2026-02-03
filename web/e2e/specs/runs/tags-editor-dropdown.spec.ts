import { test, expect } from "@playwright/test";
import { waitForTRPC, navigateToProjects } from "../../utils/test-helpers";

test.describe("Tags Editor Dropdown UI", () => {
  const orgSlug = "smoke-test-org";

  test("should open tag editor dropdown when clicking edit button in runs table", async ({ page }) => {
    // Navigate to projects page
    await navigateToProjects(page, orgSlug);

    // Find and navigate to first project
    const firstProjectLink = page.locator('a[href*="/projects/"]').first();
    if ((await firstProjectLink.count()) === 0) {
      test.skip();
      return;
    }
    const projectHref = await firstProjectLink.getAttribute('href');
    if (!projectHref) {
      test.skip();
      return;
    }

    await page.goto(projectHref);
    await waitForTRPC(page);

    // Find the tags edit button (Pencil icon with title "Edit tags")
    const editTagsButton = page.locator('button[title="Edit tags"]').first();

    // If no edit button exists, skip (no runs in table)
    if ((await editTagsButton.count()) === 0) {
      console.log("No tags edit button found, skipping test");
      test.skip();
      return;
    }

    // Click the edit button and wait for popover to appear
    // Use toPass() for resilience against animation/rendering delays
    await expect(async () => {
      await editTagsButton.click();
      const searchInput = page.locator('[placeholder="Search or add tag..."]');
      await expect(searchInput).toBeVisible({ timeout: 2000 });
    }).toPass({ timeout: 10000 });

    const searchInput = page.locator('[placeholder="Search or add tag..."]');

    // Verify popover content structure (use more specific selector since multiple popovers may exist)
    // Find the popover that contains the search input
    const popoverContent = page.locator('[data-radix-popper-content-wrapper]').filter({
      has: searchInput
    });
    await expect(popoverContent).toBeVisible();

    // Close by clicking outside
    await page.click('body', { position: { x: 10, y: 10 } });

    // Verify popover closes
    await expect(searchInput).not.toBeVisible({ timeout: 3000 });
  });
});
