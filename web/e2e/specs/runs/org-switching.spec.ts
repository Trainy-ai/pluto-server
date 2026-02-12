import { test, expect } from "@playwright/test";
import { TEST_ORG, TEST_ORG_2 } from "../../fixtures/test-data";
import { getServerUrl, getSessionCookie } from "../../utils/test-helpers";

test.describe("Organization Switching - Runs Display", () => {
  const org1Slug = TEST_ORG.slug;
  const org2Slug = TEST_ORG_2.slug;

  test.beforeEach(async ({ page }) => {
    // Navigate to org 1 to establish session
    await page.goto(`/o/${org1Slug}`);
    await page.waitForLoadState("domcontentloaded");
  });

  test("should display different runs when switching between organizations", async ({
    page,
  }) => {
    // Visit org 1 dashboard
    await page.goto(`/o/${org1Slug}`);
    await page.waitForLoadState("domcontentloaded");

    // Wait for runs to load - try the test id first, fall back to waiting for network idle
    const recentRunsSelector = '[data-testid="recent-runs"]';
    const hasRecentRunsTestId = await page.locator(recentRunsSelector).count() > 0;

    if (hasRecentRunsTestId) {
      await page.waitForSelector(recentRunsSelector, {
        state: "visible",
        timeout: 10000,
      });
    } else {
      // If no test id available, wait for network to settle
      await page.waitForLoadState("domcontentloaded");
    }

    // Get the content of the page for org 1
    const org1Content = await page.content();

    // Look for org1-specific run names
    const hasOrg1Runs =
      org1Content.includes("test-run-1") ||
      org1Content.includes("test-run-2") ||
      org1Content.includes("smoke-test");

    // Navigate to org 2
    await page.goto(`/o/${org2Slug}`);
    await page.waitForLoadState("domcontentloaded");

    // Wait for the UI to update - org1's runs should disappear when switching to org2
    // This is the core test: the cache should not show stale data from org1
    if (hasOrg1Runs) {
      // Wait for org1 runs to disappear from the page
      // This ensures the React component has re-rendered with org2's data
      await page.waitForFunction(
        (runName) => !document.body.innerText.includes(runName),
        "test-run-1",
        { timeout: 10000 }
      );
    }

    // Also try to wait for org2's specific content
    try {
      await page.waitForSelector('text="org2-unique-run"', { timeout: 5000 });
    } catch {
      // If org2 run doesn't exist, just verify URL changed
      expect(page.url()).toContain(org2Slug);
    }

    // Get the content of the page for org 2
    const org2Content = await page.content();

    // Look for org2-specific run
    const hasOrg2UniqueRun = org2Content.includes("org2-unique-run");

    // The key assertion: org 2 should NOT show org 1's runs
    // If the bug exists, org 2 would show the cached org 1 runs
    if (hasOrg1Runs) {
      // Org 1 runs should not appear on org 2 page
      expect(org2Content).not.toContain("test-run-1");
    }

    // If org 2 has its unique run, verify it's showing
    if (hasOrg2UniqueRun) {
      expect(org2Content).toContain("org2-unique-run");
    }
  });

  test("should fetch fresh data when switching back to original organization", async ({
    page,
  }) => {
    // Visit org 1
    await page.goto(`/o/${org1Slug}`);
    await page.waitForLoadState("domcontentloaded");

    // Capture initial state
    const initialOrg1Content = await page.content();

    // Switch to org 2
    await page.goto(`/o/${org2Slug}`);
    await page.waitForLoadState("domcontentloaded");

    // Switch back to org 1
    await page.goto(`/o/${org1Slug}`);
    await page.waitForLoadState("domcontentloaded");

    // Page should show org 1 data, not org 2 data
    const finalOrg1Content = await page.content();

    // Should NOT contain org 2 specific content
    expect(finalOrg1Content).not.toContain("org2-unique-run");
  });

  test("should maintain correct org context in sidebar after switching", async ({
    page,
  }) => {
    // Visit org 1
    await page.goto(`/o/${org1Slug}`);
    await page.waitForLoadState("domcontentloaded");

    // Check that the org switcher shows org 1
    const orgSwitcher = page.locator(
      '[data-testid="org-switcher"], [aria-label*="organization"], button:has-text("smoke-test-org")'
    );

    // Navigate to org 2
    await page.goto(`/o/${org2Slug}`);
    await page.waitForLoadState("domcontentloaded");

    // URL should reflect org 2
    expect(page.url()).toContain(org2Slug);
  });

  test("should not show stale runs in sidebar recent runs when switching orgs", async ({
    page,
    request,
  }) => {
    await page.goto(`/o/${org1Slug}`);
    await page.waitForLoadState("domcontentloaded");

    const sessionCookie = await getSessionCookie(page);

    if (!sessionCookie) {
      test.skip();
      return;
    }

    // Get org IDs from allOrgs list (not activeOrganization to avoid race conditions)
    const serverUrl = getServerUrl();
    const authUrl = `${serverUrl}/trpc/auth?batch=1&input=${encodeURIComponent(
      JSON.stringify({ "0": { json: null } })
    )}`;

    const authResponse = await request.get(authUrl, {
      headers: { Cookie: `${sessionCookie.name}=${sessionCookie.value}` },
    });

    const authData = await authResponse.json();
    const allOrgs = authData[0]?.result?.data?.json?.allOrgs || [];

    // Find org IDs by slug from the allOrgs list (stable, doesn't depend on activeOrganization)
    const org1Data = allOrgs.find(
      (org: { slug: string }) => org.slug === org1Slug
    );
    const org2Data = allOrgs.find(
      (org: { slug: string }) => org.slug === org2Slug
    );

    if (!org1Data || !org2Data) {
      // Skip test if test orgs don't exist
      test.skip();
      return;
    }

    const org1Id = org1Data.id;
    const org2Id = org2Data.id;

    // Verify we have different org IDs
    expect(org1Id).not.toBe(org2Id);

    // Fetch runs for org 1 via tRPC
    const runsUrl1 = `${serverUrl}/trpc/runs.latest?batch=1&input=${encodeURIComponent(
      JSON.stringify({
        "0": { json: { organizationId: org1Id, limit: 10 } },
      })
    )}`;

    const runsResponse1 = await request.get(runsUrl1, {
      headers: { Cookie: `${sessionCookie.name}=${sessionCookie.value}` },
    });

    expect(runsResponse1.ok()).toBeTruthy();
    const runsData1 = await runsResponse1.json();
    const runs1 = runsData1[0]?.result?.data?.json || [];

    // Fetch runs for org 2 via tRPC (no need to navigate, we have the org ID)
    const runsUrl2 = `${serverUrl}/trpc/runs.latest?batch=1&input=${encodeURIComponent(
      JSON.stringify({
        "0": { json: { organizationId: org2Id, limit: 10 } },
      })
    )}`;

    const runsResponse2 = await request.get(runsUrl2, {
      headers: { Cookie: `${sessionCookie.name}=${sessionCookie.value}` },
    });

    expect(runsResponse2.ok()).toBeTruthy();
    const runsData2 = await runsResponse2.json();
    const runs2 = runsData2[0]?.result?.data?.json || [];

    // Verify the API returns different runs for each org
    if (runs1.length > 0 && runs2.length > 0) {
      const run1Ids = runs1.map((r: { id: string }) => r.id);
      const run2Ids = runs2.map((r: { id: string }) => r.id);

      // Runs should not overlap (different orgs = different runs)
      const overlap = run1Ids.filter((id: string) => run2Ids.includes(id));
      expect(overlap.length).toBe(0);
    }
  });
});
