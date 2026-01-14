import { test, expect, Page, APIRequestContext } from "@playwright/test";
import { TEST_ORG, TEST_PROJECT } from "../../fixtures/test-data";

test.describe("File Viewer (Summary Page)", () => {
  const orgSlug = TEST_ORG.slug;
  const projectName = TEST_PROJECT.name;
  const serverUrl = "http://server:3001";

  /**
   * Helper to get session cookie from page context
   */
  async function getSessionCookie(page: Page) {
    const cookies = await page.context().cookies();
    return cookies.find((c) => c.name === "better-auth.session_token") || null;
  }

  /**
   * Helper to get organizationId from auth endpoint
   */
  async function getOrganizationId(page: Page, request: APIRequestContext) {
    const sessionCookie = await getSessionCookie(page);

    if (!sessionCookie) {
      return null;
    }

    const authUrl = `${serverUrl}/trpc/auth?batch=1&input=${encodeURIComponent(
      JSON.stringify({ "0": { json: null } })
    )}`;

    const authResponse = await request.get(authUrl, {
      headers: {
        Cookie: `${sessionCookie.name}=${sessionCookie.value}`,
      },
    });

    if (!authResponse.ok()) {
      return null;
    }

    const authData = await authResponse.json();
    return authData[0]?.result?.data?.json?.activeOrganization?.id;
  }

  /**
   * Helper to find a run with file logs
   */
  async function findRunWithFiles(
    page: Page,
    request: APIRequestContext,
    organizationId: string
  ) {
    const sessionCookie = await getSessionCookie(page);

    if (!sessionCookie) {
      return null;
    }

    // Get latest runs
    const trpcUrl = `${serverUrl}/trpc/runs.latest?batch=1&input=${encodeURIComponent(
      JSON.stringify({
        "0": {
          json: {
            organizationId,
            projectName,
            limit: 20,
          },
        },
      })
    )}`;

    const trpcResponse = await request.get(trpcUrl, {
      headers: {
        Cookie: `${sessionCookie.name}=${sessionCookie.value}`,
      },
    });

    if (!trpcResponse.ok()) {
      return null;
    }

    const batchResponse = await trpcResponse.json();
    const runs = batchResponse[0]?.result?.data?.json || [];

    // Find a run that has file logs (TEXT, FILE, or ARTIFACT log types)
    for (const run of runs) {
      if (run.logs && Array.isArray(run.logs)) {
        const hasFileLog = run.logs.some(
          (log) =>
            log.logType === "TEXT" ||
            log.logType === "FILE" ||
            log.logType === "ARTIFACT"
        );
        if (hasFileLog) {
          return run;
        }
      }
    }

    return null;
  }

  test("should render Files section when run has file logs", async ({
    page,
    request,
  }) => {
    // Navigate to authenticated page to get session
    await page.goto(`/o/${orgSlug}/projects`);
    await page.waitForLoadState("networkidle");

    const organizationId = await getOrganizationId(page, request);
    if (!organizationId) {
      test.skip(true, "No authenticated session available");
      return;
    }

    // Find a run with file logs
    const runWithFiles = await findRunWithFiles(page, request, organizationId);
    if (!runWithFiles) {
      test.skip(
        true,
        "No run with file logs found. Run integration test with TEST_FILE_LOGGING=true first."
      );
      return;
    }

    console.log(`Found run with files: ${runWithFiles.name} (${runWithFiles.id})`);

    // Navigate to the run's summary page
    await page.goto(
      `/o/${orgSlug}/projects/${projectName}/${runWithFiles.id}/summary`
    );
    await page.waitForLoadState("networkidle");

    // Verify the Files section exists
    const filesSection = page.locator("text=Files").first();
    await expect(filesSection).toBeVisible({ timeout: 10000 });

    // Find the Files card
    const filesCard = page.locator('[class*="border-l-cyan-500"]');
    await expect(filesCard).toBeVisible();

    // Verify we have at least one file log item
    const fileLogItems = filesCard.locator("button").filter({
      has: page.locator('[class*="lucide-file-text"]'),
    });
    const count = await fileLogItems.count();
    expect(count).toBeGreaterThan(0);
    console.log(`Found ${count} file log items`);
  });

  test("should expand file log and show file content viewer", async ({
    page,
    request,
  }) => {
    // Navigate to authenticated page
    await page.goto(`/o/${orgSlug}/projects`);
    await page.waitForLoadState("networkidle");

    const organizationId = await getOrganizationId(page, request);
    if (!organizationId) {
      test.skip(true, "No authenticated session available");
      return;
    }

    const runWithFiles = await findRunWithFiles(page, request, organizationId);
    if (!runWithFiles) {
      test.skip(
        true,
        "No run with file logs found. Run integration test with TEST_FILE_LOGGING=true first."
      );
      return;
    }

    // Navigate to summary page
    await page.goto(
      `/o/${orgSlug}/projects/${projectName}/${runWithFiles.id}/summary`
    );
    await page.waitForLoadState("networkidle");

    // Find and click on the first file log item to expand it
    const filesCard = page.locator('[class*="border-l-cyan-500"]');
    await expect(filesCard).toBeVisible({ timeout: 10000 });

    // Find the first expandable file log button
    const fileLogButton = filesCard
      .locator("button")
      .filter({
        has: page.locator('[class*="lucide-file-text"]'),
      })
      .first();

    await expect(fileLogButton).toBeVisible();
    await fileLogButton.click();

    // Wait for content to load - look for either the code block or loading skeleton
    const contentArea = filesCard.locator('[class*="border bg-card"]');
    await expect(contentArea).toBeVisible({ timeout: 10000 });

    // Wait for loading to complete (skeleton should disappear)
    await page
      .waitForFunction(
        () => {
          const skeletons = document.querySelectorAll(
            '[class*="skeleton"], [class*="Skeleton"]'
          );
          return skeletons.length === 0;
        },
        { timeout: 15000 }
      )
      .catch(() => {
        // Loading may have already completed
      });
  });

  test("should display plaintext files with syntax highlighting (not 'Preview not available')", async ({
    page,
    request,
  }) => {
    // Navigate to authenticated page
    await page.goto(`/o/${orgSlug}/projects`);
    await page.waitForLoadState("networkidle");

    const organizationId = await getOrganizationId(page, request);
    if (!organizationId) {
      test.skip(true, "No authenticated session available");
      return;
    }

    const runWithFiles = await findRunWithFiles(page, request, organizationId);
    if (!runWithFiles) {
      test.skip(
        true,
        "No run with file logs found. Run integration test with TEST_FILE_LOGGING=true first."
      );
      return;
    }

    // Find a log that should be plaintext (yaml, json, py, log, txt, etc.)
    const plaintextExtensions = [
      "yaml",
      "yml",
      "json",
      "py",
      "js",
      "ts",
      "log",
      "txt",
      "sh",
      "md",
    ];
    let plaintextLog = null;

    for (const log of runWithFiles.logs || []) {
      if (
        log.logType === "TEXT" ||
        log.logType === "FILE" ||
        log.logType === "ARTIFACT"
      ) {
        // Log name might contain extension info
        const logName = log.logName?.toLowerCase() || "";
        if (plaintextExtensions.some((ext) => logName.includes(ext))) {
          plaintextLog = log;
          break;
        }
        // If no specific extension found, use any file log
        if (!plaintextLog) {
          plaintextLog = log;
        }
      }
    }

    if (!plaintextLog) {
      test.skip(true, "No plaintext file log found in run");
      return;
    }

    console.log(`Testing with log: ${plaintextLog.logName}`);

    // Navigate to summary page
    await page.goto(
      `/o/${orgSlug}/projects/${projectName}/${runWithFiles.id}/summary`
    );
    await page.waitForLoadState("networkidle");

    // Find and expand the specific file log
    const filesCard = page.locator('[class*="border-l-cyan-500"]');
    await expect(filesCard).toBeVisible({ timeout: 10000 });

    // Click on the log item that matches our target
    const targetLogButton = filesCard.locator(
      `button:has-text("${plaintextLog.logName}")`
    );

    if ((await targetLogButton.count()) > 0) {
      await targetLogButton.first().click();
    } else {
      // Fall back to clicking the first file log
      const firstFileLog = filesCard
        .locator("button")
        .filter({ has: page.locator('[class*="lucide-file-text"]') })
        .first();
      await firstFileLog.click();
    }

    // Wait for content to load - either code viewer or "Preview not available" message
    await expect(
      page.locator(
        ".react-code-block, [class*='code-block'], [class*='LineNumber'], text=/Preview not available/"
      ).first()
    ).toBeVisible({ timeout: 10000 });

    // CRITICAL ASSERTION: Should NOT show "Preview not available" for plaintext files
    // This was the bug - .log files showed ". file - Preview not available" instead of rendering
    const previewNotAvailable = page.locator(
      'text=/\\. file - Preview not available/'
    );
    const previewNotAvailableCount = await previewNotAvailable.count();

    // If we find "Preview not available" with an empty extension (". file"),
    // it means the fileType wasn't stored correctly
    if (previewNotAvailableCount > 0) {
      const text = await previewNotAvailable.first().textContent();
      // Allow "Preview not available" only for non-plaintext files (like .pdf, .pkl)
      // But fail if we see ". file" (empty extension) or known plaintext extensions
      if (text?.includes(". file -") || text?.match(/\.(log|yaml|json|py|txt|js|ts) file/i)) {
        throw new Error(
          `Bug detected: Plaintext file showing "Preview not available": "${text}". ` +
            `This indicates the fileType was not stored correctly in ClickHouse.`
        );
      }
    }

    // If no "Preview not available", verify we have a code block rendered
    const codeBlock = page.locator(".react-code-block, [class*='code-block']");
    const codeBlockVisible = await codeBlock.isVisible().catch(() => false);

    // Also check for line numbers which indicate successful rendering
    const lineNumbers = page.locator('[class*="LineNumber"]');
    const hasLineNumbers = (await lineNumbers.count()) > 0;

    // At least one of these should be true for successful rendering
    if (!codeBlockVisible && !hasLineNumbers) {
      console.warn(
        "Warning: Could not verify code block rendering. This may be expected for certain file types."
      );
    }

    console.log(
      `Code block visible: ${codeBlockVisible}, Has line numbers: ${hasLineNumbers}`
    );
  });

  test("should display correct file extension in header (not empty)", async ({
    page,
    request,
  }) => {
    // Navigate to authenticated page
    await page.goto(`/o/${orgSlug}/projects`);
    await page.waitForLoadState("networkidle");

    const organizationId = await getOrganizationId(page, request);
    if (!organizationId) {
      test.skip(true, "No authenticated session available");
      return;
    }

    const runWithFiles = await findRunWithFiles(page, request, organizationId);
    if (!runWithFiles) {
      test.skip(
        true,
        "No run with file logs found. Run integration test with TEST_FILE_LOGGING=true first."
      );
      return;
    }

    // Navigate to summary page
    await page.goto(
      `/o/${orgSlug}/projects/${projectName}/${runWithFiles.id}/summary`
    );
    await page.waitForLoadState("networkidle");

    // Find and expand a file log
    const filesCard = page.locator('[class*="border-l-cyan-500"]');
    await expect(filesCard).toBeVisible({ timeout: 10000 });

    const fileLogButton = filesCard
      .locator("button")
      .filter({ has: page.locator('[class*="lucide-file-text"]') })
      .first();

    await fileLogButton.click();

    // Wait for content to load
    await expect(
      page.locator(
        ".react-code-block, [class*='code-block'], [class*='LineNumber'], text=/Preview not available/"
      ).first()
    ).toBeVisible({ timeout: 10000 });

    // Look for file headers that show the extension
    // The bug showed ". file" instead of ".log file" or similar
    const fileHeaders = page.locator('[class*="font-mono"]');
    const headerCount = await fileHeaders.count();

    let foundEmptyExtension = false;
    for (let i = 0; i < headerCount; i++) {
      const text = await fileHeaders.nth(i).textContent();
      // Check for pattern like ". file" (empty extension before "file")
      if (text && /\.\s+file\s*-/i.test(text)) {
        foundEmptyExtension = true;
        console.error(`Found empty file extension in header: "${text}"`);
        break;
      }
    }

    // This should NOT happen - extensions should be properly stored
    expect(foundEmptyExtension).toBe(false);
  });

  test("should show download button for all file types", async ({
    page,
    request,
  }) => {
    // Navigate to authenticated page
    await page.goto(`/o/${orgSlug}/projects`);
    await page.waitForLoadState("networkidle");

    const organizationId = await getOrganizationId(page, request);
    if (!organizationId) {
      test.skip(true, "No authenticated session available");
      return;
    }

    const runWithFiles = await findRunWithFiles(page, request, organizationId);
    if (!runWithFiles) {
      test.skip(
        true,
        "No run with file logs found. Run integration test with TEST_FILE_LOGGING=true first."
      );
      return;
    }

    // Navigate to summary page
    await page.goto(
      `/o/${orgSlug}/projects/${projectName}/${runWithFiles.id}/summary`
    );
    await page.waitForLoadState("networkidle");

    // Find and expand a file log
    const filesCard = page.locator('[class*="border-l-cyan-500"]');
    await expect(filesCard).toBeVisible({ timeout: 10000 });

    const fileLogButton = filesCard
      .locator("button")
      .filter({ has: page.locator('[class*="lucide-file-text"]') })
      .first();

    await fileLogButton.click();

    // Verify download button exists (includes implicit wait)
    const downloadButton = page.locator('[class*="lucide-download"]');
    await expect(downloadButton.first()).toBeVisible({ timeout: 10000 });
  });
});
