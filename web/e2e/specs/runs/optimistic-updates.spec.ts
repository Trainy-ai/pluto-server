import { test, expect } from "@playwright/test";
import {
  waitForPageReady,
  navigateToFirstProject,
  waitForRunsTable,
} from "../../utils/test-helpers";
import { TEST_ORG } from "../../fixtures/test-data";

test.describe("Optimistic Updates for Tags & Notes", () => {
  // Run serially: all tests modify tags/notes on the same first run.
  // updateTags replaces the full array, so parallel mutations race —
  // the last write wins and earlier changes are lost.
  test.describe.configure({ mode: "serial" });

  const orgSlug = TEST_ORG.slug;

  test("tags update appears instantly in the runs table", async ({ page }) => {
    const projectHref = await navigateToFirstProject(page, orgSlug);
    if (!projectHref) {
      test.skip();
      return;
    }

    await waitForRunsTable(page);

    // Find the first tags edit button
    const editTagsButton = page.locator('button[title="Edit tags"]').first();
    if ((await editTagsButton.count()) === 0) {
      test.skip();
      return;
    }

    // Open the tag editor popover
    await expect(async () => {
      await editTagsButton.click();
      await expect(
        page.locator('[placeholder="Search or add tag..."]')
      ).toBeVisible({ timeout: 2000 });
    }).toPass({ timeout: 10000 });

    // Type a unique tag name and add it via the "Create" button
    const uniqueTag = `e2e-optimistic-${Date.now()}`;
    const searchInput = page.locator('[placeholder="Search or add tag..."]');
    await searchInput.fill(uniqueTag);

    // Click the "Create" button that appears for new tags (more reliable than Enter in cmdk)
    const popoverContent = page
      .locator('[data-radix-popper-content-wrapper]')
      .filter({ has: searchInput });
    const createButton = popoverContent.locator("button", {
      hasText: `Create`,
    });
    await expect(createButton).toBeVisible({ timeout: 5000 });
    await createButton.click();

    // Click the Apply button to commit the change
    const applyButton = popoverContent.locator("button", { hasText: "Apply" });
    await expect(applyButton).toBeVisible({ timeout: 5000 });
    await applyButton.click();

    // Key assertion: the tag should appear in the table almost immediately
    // (optimistic update). A 2s timeout is generous enough for DOM update
    // but much shorter than a 5-10s server round-trip would take.
    await expect(page.getByText(uniqueTag)).toBeVisible({ timeout: 2000 });
  });

  test("notes update appears instantly in the runs table", async ({
    page,
  }) => {
    const projectHref = await navigateToFirstProject(page, orgSlug);
    if (!projectHref) {
      test.skip();
      return;
    }

    await waitForRunsTable(page);

    // Find the first notes edit button
    const editNotesButton = page
      .locator('button[title="Edit notes"]')
      .first();
    if ((await editNotesButton.count()) === 0) {
      test.skip();
      return;
    }

    // Open the notes popover
    await expect(async () => {
      await editNotesButton.click();
      await expect(
        page.locator('[placeholder="Add a note about this run..."]')
      ).toBeVisible({ timeout: 2000 });
    }).toPass({ timeout: 10000 });

    // Type a unique note
    const uniqueNote = `e2e-note-${Date.now()}`;
    const textarea = page.locator(
      '[placeholder="Add a note about this run..."]'
    );
    await textarea.fill(uniqueNote);

    // Click Save
    const saveButton = page
      .locator('[data-radix-popper-content-wrapper]')
      .filter({ has: textarea })
      .locator("button", { hasText: "Save" });
    await saveButton.click();

    // Key assertion: the note should appear instantly (optimistic update)
    await expect(page.getByText(uniqueNote)).toBeVisible({ timeout: 2000 });
  });

  test("tags persist after page reload", async ({ page }) => {
    const projectHref = await navigateToFirstProject(page, orgSlug);
    if (!projectHref) {
      test.skip();
      return;
    }

    await waitForRunsTable(page);

    const editTagsButton = page.locator('button[title="Edit tags"]').first();
    if ((await editTagsButton.count()) === 0) {
      test.skip();
      return;
    }

    // Add a unique tag
    await expect(async () => {
      await editTagsButton.click();
      await expect(
        page.locator('[placeholder="Search or add tag..."]')
      ).toBeVisible({ timeout: 2000 });
    }).toPass({ timeout: 10000 });

    const persistTag = `e2e-persist-${Date.now()}`;
    const searchInput = page.locator('[placeholder="Search or add tag..."]');
    await searchInput.fill(persistTag);

    // Click the "Create" button that appears for new tags (more reliable than Enter in cmdk)
    const popoverContent = page
      .locator('[data-radix-popper-content-wrapper]')
      .filter({ has: searchInput });
    const createButton = popoverContent.locator("button", {
      hasText: `Create`,
    });
    await expect(createButton).toBeVisible({ timeout: 5000 });
    await createButton.click();

    const applyButton = popoverContent.locator("button", {
      hasText: "Apply",
    });

    // Set up response listener BEFORE clicking to avoid race condition
    const mutationResponse = page.waitForResponse(
      (resp) => resp.url().includes("/trpc/") && resp.url().includes("updateTags") && resp.status() === 200,
      { timeout: 15000 },
    );
    await applyButton.click();

    // Wait for both the optimistic UI update and the backend response
    await expect(page.getByText(persistTag)).toBeVisible({ timeout: 2000 });
    await mutationResponse;

    // Reload and verify the tag persisted (backend saved it)
    await page.reload();
    await waitForPageReady(page);
    await waitForRunsTable(page);

    await expect(page.getByText(persistTag)).toBeAttached({ timeout: 10000 });
  });

  test("notes persist after page reload", async ({ page }) => {
    const projectHref = await navigateToFirstProject(page, orgSlug);
    if (!projectHref) {
      test.skip();
      return;
    }

    await waitForRunsTable(page);

    const editNotesButton = page
      .locator('button[title="Edit notes"]')
      .first();
    if ((await editNotesButton.count()) === 0) {
      test.skip();
      return;
    }

    // Add a unique note
    await expect(async () => {
      await editNotesButton.click();
      await expect(
        page.locator('[placeholder="Add a note about this run..."]')
      ).toBeVisible({ timeout: 2000 });
    }).toPass({ timeout: 10000 });

    const persistNote = `e2e-persist-note-${Date.now()}`;
    const textarea = page.locator(
      '[placeholder="Add a note about this run..."]'
    );
    await textarea.fill(persistNote);

    const saveButton = page
      .locator('[data-radix-popper-content-wrapper]')
      .filter({ has: textarea })
      .locator("button", { hasText: "Save" });

    // Set up response listener BEFORE clicking to avoid race condition
    const mutationResponse = page.waitForResponse(
      (resp) => resp.url().includes("/trpc/") && resp.url().includes("updateNotes") && resp.status() === 200,
      { timeout: 15000 },
    );
    await saveButton.click();

    // Wait for both the optimistic UI update and the backend response
    await expect(page.getByText(persistNote)).toBeVisible({ timeout: 2000 });
    await mutationResponse;

    // Reload and verify the note persisted (check DOM attachment since the
    // notes column may CSS-truncate text to invisible in narrow CI viewports)
    await page.reload();
    await waitForPageReady(page);
    await waitForRunsTable(page);

    await expect(page.getByText(persistNote)).toBeAttached({ timeout: 10000 });
  });
});
