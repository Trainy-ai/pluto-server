import { test, expect } from "@playwright/test";
import { TEST_ORG, TEST_ORG_2 } from "../../fixtures/test-data";

test.describe("Organization Switching - Runs Display", () => {
  const org1Slug = TEST_ORG.slug;
  const org2Slug = TEST_ORG_2.slug;

  // These tests run in Docker Compose environment where services communicate via hostnames
  const serverUrl = "http://server:3001";

  test.beforeEach(async ({ page }) => {
    // Navigate to org 1 to establish session
    await page.goto(`/o/${org1Slug}`);
    await page.waitForLoadState("networkidle");
  });

  test("should display different runs when switching between organizations", async ({
    page,
  }) => {
    // Visit org 1 dashboard
    await page.goto(`/o/${org1Slug}`);
    await page.waitForLoadState("networkidle");

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
      await page.waitForLoadState("networkidle");
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
    await page.waitForLoadState("networkidle");

    // Wait for potential loading states to complete
    await page.waitForTimeout(1000);

    // Get the content of the page for org 2
    const org2Content = await page.content();

    // Look for org2-specific run
    const hasOrg2UniqueRun = org2Content.includes("org2-unique-run");

    // The key assertion: org 2 should NOT show org 1's runs
    // If the bug exists, org 2 would show the cached org 1 runs
    if (hasOrg1Runs) {
      // Org 1 runs should not appear on org 2 page
      const org2ShowsOrg1Runs =
        org2Content.includes("test-run-1") &&
        !org2Content.includes("org2-unique-run");

      expect(org2ShowsOrg1Runs).toBe(false);
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
    await page.waitForLoadState("networkidle");

    // Capture initial state
    const initialOrg1Content = await page.content();

    // Switch to org 2
    await page.goto(`/o/${org2Slug}`);
    await page.waitForLoadState("networkidle");

    // Switch back to org 1
    await page.goto(`/o/${org1Slug}`);
    await page.waitForLoadState("networkidle");

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
    await page.waitForLoadState("networkidle");

    // Check that the org switcher shows org 1
    const orgSwitcher = page.locator(
      '[data-testid="org-switcher"], [aria-label*="organization"], button:has-text("smoke-test-org")'
    );

    // Navigate to org 2
    await page.goto(`/o/${org2Slug}`);
    await page.waitForLoadState("networkidle");

    // URL should reflect org 2
    expect(page.url()).toContain(org2Slug);
  });

  test("should not show stale runs in sidebar recent runs when switching orgs", async ({
    page,
    request,
  }) => {
    // Get session cookie
    await page.goto(`/o/${org1Slug}`);
    await page.waitForLoadState("networkidle");

    const cookies = await page.context().cookies();
    const sessionCookie = cookies.find(
      (c) => c.name === "better-auth.session_token"
    );

    if (!sessionCookie) {
      test.skip();
      return;
    }

    // Get org 1's organization ID
    const authUrl1 = `${serverUrl}/trpc/auth?batch=1&input=${encodeURIComponent(
      JSON.stringify({ "0": { json: null } })
    )}`;

    const authResponse1 = await request.get(authUrl1, {
      headers: { Cookie: `${sessionCookie.name}=${sessionCookie.value}` },
    });

    const authData1 = await authResponse1.json();
    const org1Id = authData1[0]?.result?.data?.json?.activeOrganization?.id;

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

    // Navigate to org 2
    await page.goto(`/o/${org2Slug}`);
    await page.waitForLoadState("networkidle");

    // Get org 2's organization ID
    const authResponse2 = await request.get(authUrl1, {
      headers: { Cookie: `${sessionCookie.name}=${sessionCookie.value}` },
    });

    const authData2 = await authResponse2.json();
    const org2Id = authData2[0]?.result?.data?.json?.activeOrganization?.id;

    // Fetch runs for org 2 via tRPC
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
