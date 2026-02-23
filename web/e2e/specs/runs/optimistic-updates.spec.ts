import { test, expect } from "@playwright/test";
import {
  navigateToFirstProject,
  waitForRunsTable,
} from "../../utils/test-helpers";
import { TEST_ORG } from "../../fixtures/test-data";

test.describe("Optimistic Updates for Tags & Notes", () => {
  const orgSlug = TEST_ORG.slug;

  test("tags update appears instantly and saves correctly", async ({
    page,
  }) => {
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

    // Set up mutation response listener before interaction
    const mutationResponse = page.waitForResponse(
      (resp) =>
        resp.url().includes("/trpc/") &&
        resp.url().includes("updateTags") &&
        resp.status() === 200,
      { timeout: 30000 },
    );

    // Open popover, type tag, click Create — all retryable as a single unit.
    // If the popover closes mid-interaction (focus loss, animation timing),
    // the whole sequence retries from the click.
    const uniqueTag = `e2e-optimistic-${Date.now()}`;
    await expect(async () => {
      await editTagsButton.click();
      const searchInput = page.locator('[placeholder="Search or add tag..."]');
      await expect(searchInput).toBeVisible({ timeout: 2000 });
      await searchInput.click();
      await searchInput.fill(uniqueTag);
      const popoverContent = page
        .locator('[data-radix-popper-content-wrapper]')
        .filter({ has: searchInput });
      const createButton = popoverContent.locator("button", {
        hasText: "Create",
      });
      await expect(createButton).toBeVisible({ timeout: 5000 });
      await createButton.click();
    }).toPass({ timeout: 15000 });

    // Click the Apply button to commit the change
    const searchInput = page.locator('[placeholder="Search or add tag..."]');
    const popoverContent = page
      .locator('[data-radix-popper-content-wrapper]')
      .filter({ has: searchInput });
    const applyButton = popoverContent.locator("button", { hasText: "Apply" });
    await expect(applyButton).toBeVisible({ timeout: 5000 });
    await applyButton.click();

    // Key assertion: the tag should appear in the table almost immediately
    // (optimistic update). A 2s timeout is generous enough for DOM update
    // but much shorter than a 5-10s server round-trip would take.
    await expect(page.getByText(uniqueTag)).toBeVisible({ timeout: 2000 });

    // Verify the backend mutation also succeeded.
    // tRPC batch responses return HTTP 200 even when procedures fail —
    // the error is embedded in the JSON body.
    const resp = await mutationResponse;
    const body = await resp.json();
    const firstResult = Array.isArray(body) ? body[0] : body;
    expect(
      firstResult?.error,
      `updateTags mutation returned error: ${JSON.stringify(firstResult?.error)}`,
    ).toBeUndefined();

    const savedTags = firstResult?.result?.data?.json?.tags;
    expect(
      savedTags,
      `updateTags result missing "${uniqueTag}". Saved tags: ${JSON.stringify(savedTags)}`,
    ).toContain(uniqueTag);
  });

  test("notes update appears instantly and saves correctly", async ({
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

    // Set up mutation response listener before interaction
    const mutationResponse = page.waitForResponse(
      (resp) =>
        resp.url().includes("/trpc/") &&
        resp.url().includes("updateNotes") &&
        resp.status() === 200,
      { timeout: 30000 },
    );

    // Open popover, type note, click Save — all retryable as a single unit.
    // If the popover closes mid-interaction (focus loss, animation timing),
    // the whole sequence retries from the click.
    const uniqueNote = `e2e-note-${Date.now()}`;
    await expect(async () => {
      await editNotesButton.click();
      const textarea = page.locator(
        '[placeholder="Add a note about this run..."]',
      );
      await expect(textarea).toBeVisible({ timeout: 2000 });
      await textarea.fill(uniqueNote);
      const popoverContent = page
        .locator('[data-radix-popper-content-wrapper]')
        .filter({ has: textarea });
      const saveButton = popoverContent.locator("button", {
        hasText: "Save",
      });
      await expect(saveButton).toBeVisible({ timeout: 2000 });
      await saveButton.click();
    }).toPass({ timeout: 15000 });

    // Key assertion: the note should appear instantly (optimistic update)
    await expect(page.getByText(uniqueNote)).toBeVisible({ timeout: 2000 });

    // Verify the backend mutation also succeeded
    const resp = await mutationResponse;
    const body = await resp.json();
    const firstResult = Array.isArray(body) ? body[0] : body;
    expect(
      firstResult?.error,
      `updateNotes mutation returned error: ${JSON.stringify(firstResult?.error)}`,
    ).toBeUndefined();

    const savedNotes = firstResult?.result?.data?.json?.notes;
    expect(
      savedNotes,
      `updateNotes result missing note. Saved: ${JSON.stringify(savedNotes)}`,
    ).toBe(uniqueNote);
  });
});
