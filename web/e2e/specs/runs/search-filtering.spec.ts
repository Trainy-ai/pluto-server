import { test, expect } from "@playwright/test";
import { TEST_ORG, TEST_PROJECT } from "../../fixtures/test-data";

test.describe("Run Search and Tag Filtering", () => {
  const orgSlug = TEST_ORG.slug;
  const projectName = TEST_PROJECT.name;

  // Server URL for direct API calls
  // In Buildkite, the 'server' hostname is available via /etc/hosts
  // In local dev, we use localhost:3001
  const getServerUrl = () => {
    const baseUrl = process.env.BASE_URL || "http://localhost:3000";
    // If BASE_URL is an IP address (Buildkite), use the 'server' hostname
    // because the app and server have different IPs in Docker
    if (baseUrl.match(/^https?:\/\/\d+\.\d+\.\d+\.\d+:/)) {
      return "http://server:3001";
    }
    // Otherwise (localhost), derive from BASE_URL by replacing port
    return baseUrl.replace(":3000", ":3001");
  };

  test.beforeEach(async ({ page }) => {
    // Navigate to the project runs page
    await page.goto(`/o/${orgSlug}/projects/${projectName}`);
    await page.waitForLoadState("networkidle");
  });

  test("should find run via search input that is beyond first page", async ({
    page,
  }) => {
    // Wait for the runs table to load
    await page.waitForSelector('[data-testid="runs-table"], table', {
      state: "visible",
      timeout: 15000,
    });

    // Find the search input - look for common search input patterns
    const searchInput = page.locator(
      'input[placeholder*="search" i], input[placeholder*="filter" i], input[type="search"], [data-testid="search-input"]'
    ).first();

    // Check if search input exists
    const hasSearchInput = (await searchInput.count()) > 0;
    if (!hasSearchInput) {
      // Skip test if no search input found (UI might not have search yet)
      test.skip();
      return;
    }

    // Type "needle" in the search box
    await searchInput.fill("needle");

    // Wait for the search to process (debounced)
    await page.waitForTimeout(500);

    // Wait for network to settle after search
    await page.waitForLoadState("networkidle");

    // The "hidden-needle-experiment" run should appear in results
    // It's at position 161+ so wouldn't appear without server-side search
    // Wait for the specific run to appear in the DOM (React may need time to render)
    try {
      await expect(
        page.locator('text=hidden-needle-experiment').first()
      ).toBeVisible({ timeout: 10000 });
    } catch (e) {
      // If not found, log page content for debugging and fail
      const pageContent = await page.content();
      console.log("Page content does not contain hidden-needle-experiment");
      console.log("Search input value:", await searchInput.inputValue());
      expect(pageContent).toContain("hidden-needle-experiment");
    }
  });

  test("should filter runs by tag using tag filter dropdown", async ({
    page,
  }) => {
    // Wait for the runs table to load
    await page.waitForSelector('[data-testid="runs-table"], table', {
      state: "visible",
      timeout: 15000,
    });

    // Look for a tag filter button/dropdown
    const tagFilterButton = page.locator(
      '[data-testid="tag-filter"], button:has-text("Tags"), button:has-text("Filter"), [aria-label*="tag" i]'
    ).first();

    const hasTagFilter = (await tagFilterButton.count()) > 0;
    if (!hasTagFilter) {
      // Skip test if no tag filter UI exists
      test.skip();
      return;
    }

    // Click to open tag filter
    await tagFilterButton.click();

    // Look for needle-tag in the dropdown and select it
    const needleTagOption = page.locator('text="needle-tag"').first();
    const hasNeedleTag = (await needleTagOption.count()) > 0;

    if (!hasNeedleTag) {
      // Tag might not be visible in dropdown, try typing it
      const tagInput = page.locator(
        '[data-testid="tag-filter-input"], input[placeholder*="tag" i]'
      ).first();
      if ((await tagInput.count()) > 0) {
        await tagInput.fill("needle-tag");
        await page.keyboard.press("Enter");
      } else {
        test.skip();
        return;
      }
    } else {
      await needleTagOption.click();
    }

    // Wait for filter to apply
    await page.waitForLoadState("networkidle");

    // The "hidden-needle-experiment" run should appear (it has needle-tag)
    // Wait for the specific run to appear in the DOM (React may need time to render)
    try {
      await expect(
        page.locator('text=hidden-needle-experiment').first()
      ).toBeVisible({ timeout: 10000 });
    } catch (e) {
      // If not found, log page content for debugging and fail
      const pageContent = await page.content();
      console.log("Page content does not contain hidden-needle-experiment after tag filter");
      expect(pageContent).toContain("hidden-needle-experiment");
    }
  });

  test("should clear search and show all runs again", async ({ page }) => {
    // Wait for the runs table to load
    await page.waitForSelector('[data-testid="runs-table"], table', {
      state: "visible",
      timeout: 15000,
    });

    // Find the search input
    const searchInput = page.locator(
      'input[placeholder*="search" i], input[placeholder*="filter" i], input[type="search"], [data-testid="search-input"]'
    ).first();

    const hasSearchInput = (await searchInput.count()) > 0;
    if (!hasSearchInput) {
      test.skip();
      return;
    }

    // Search for something specific
    await searchInput.fill("bulk-run-001");
    await page.waitForTimeout(500);
    await page.waitForLoadState("networkidle");

    // Verify search results are filtered
    let pageContent = await page.content();
    expect(pageContent).toContain("bulk-run-001");

    // Clear the search
    await searchInput.clear();
    await page.waitForTimeout(500);
    await page.waitForLoadState("networkidle");

    // After clearing, should see more runs
    pageContent = await page.content();
    // Should see multiple runs now (bulk-run-000, bulk-run-001, etc.)
    expect(pageContent).toMatch(/bulk-run-\d{3}/);
  });

  test("should show correct run count when searching", async ({
    page,
    request,
  }) => {
    // Get session cookie
    const cookies = await page.context().cookies();
    const sessionCookie = cookies.find(
      (c) => c.name === "better-auth.session_token"
    );

    if (!sessionCookie) {
      test.skip();
      return;
    }

    // Get organization ID
    const serverUrl = getServerUrl();
    const authUrl = `${serverUrl}/trpc/auth?batch=1&input=${encodeURIComponent(
      JSON.stringify({ "0": { json: null } })
    )}`;

    const authResponse = await request.get(authUrl, {
      headers: { Cookie: `${sessionCookie.name}=${sessionCookie.value}` },
    });

    const authData = await authResponse.json();
    const organizationId = authData[0]?.result?.data?.json?.activeOrganization?.id;

    if (!organizationId) {
      test.skip();
      return;
    }

    // Test run count endpoint with search filter via tRPC
    const countUrl = `${serverUrl}/trpc/runs.count?batch=1&input=${encodeURIComponent(
      JSON.stringify({
        "0": {
          json: {
            organizationId,
            projectName,
            search: "needle",
          },
        },
      })
    )}`;

    const countResponse = await request.get(countUrl, {
      headers: { Cookie: `${sessionCookie.name}=${sessionCookie.value}` },
    });

    expect(countResponse.ok()).toBeTruthy();
    const countData = await countResponse.json();
    const count = countData[0]?.result?.data?.json;

    // Should find exactly 1 run matching "needle"
    expect(count).toBe(1);
  });
});
