import { test, expect } from "@playwright/test";
import { TEST_ORG, TEST_PROJECT } from "../../fixtures/test-data";

test.describe("Run Tags Management (tRPC API)", () => {
  const orgSlug = TEST_ORG.slug;
  const projectName = TEST_PROJECT.name;

  // These tests run in Docker Compose environment where services communicate via hostnames
  // Always use server:3001 since Playwright container can reach backend via Docker networking
  const serverUrl = "http://server:3001";

  test("should update run tags via HTTP API endpoint", async ({ page, request }) => {
    // Create a run via HTTP API (using API key from environment)
    const apiKey = process.env.TEST_API_KEY || "";

    if (!apiKey) {
      test.skip();
      return;
    }

    const timestamp = Date.now();
    const runName = `e2e-tags-test-${timestamp}`;

    // Create run with initial tags
    const createResponse = await request.post(`${serverUrl}/api/runs/create`, {
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      data: {
        projectName,
        runName,
        tags: ["initial-tag", "test"],
      },
    });

    expect(createResponse.ok()).toBeTruthy();
    const { runId } = await createResponse.json();
    expect(runId).toBeDefined();

    // Update tags via HTTP API
    const updateResponse = await request.post(`${serverUrl}/api/runs/tags/update`, {
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      data: {
        runId,
        tags: ["updated-tag-1", "updated-tag-2", "e2e-test"],
      },
    });

    expect(updateResponse.ok()).toBeTruthy();
    const updateData = await updateResponse.json();
    expect(updateData.success).toBe(true);
  });

  test("should filter runs by tags via tRPC endpoint", async ({ page, request }) => {
    // Navigate to authenticated page to get session
    await page.goto(`/o/${orgSlug}/projects`);
    await page.waitForLoadState("networkidle");

    // Get session cookie
    const cookies = await page.context().cookies();
    const sessionCookie = cookies.find(c => c.name === "better-auth.session_token");

    if (!sessionCookie) {
      test.skip();
      return;
    }

    // Get the organizationId from the auth endpoint
    const authUrl = `${serverUrl}/trpc/auth?batch=1&input=${encodeURIComponent(
      JSON.stringify({
        "0": {
          "json": null
        }
      })
    )}`;

    const authResponse = await request.get(authUrl, {
      headers: {
        "Cookie": `${sessionCookie.name}=${sessionCookie.value}`,
      },
    });

    expect(authResponse.ok()).toBeTruthy();
    const authData = await authResponse.json();
    const organizationId = authData[0]?.result?.data?.json?.activeOrganization?.id;
    expect(organizationId).toBeDefined();

    // Call tRPC latest-runs with tag filter
    // tRPC v11 uses batch format for requests
    const trpcUrl = `${serverUrl}/trpc/runs.latest?batch=1&input=${encodeURIComponent(
      JSON.stringify({
        "0": {
          "json": {
            organizationId,
            projectName,
            tags: ["test"],
            limit: 10,
          }
        }
      })
    )}`;

    const trpcResponse = await request.get(trpcUrl, {
      headers: {
        "Cookie": `${sessionCookie.name}=${sessionCookie.value}`,
      },
    });

    expect(trpcResponse.ok()).toBeTruthy();
    const batchResponse = await trpcResponse.json();
    console.log("Filtered runs response:", batchResponse);

    // tRPC batch response format: array with results
    expect(Array.isArray(batchResponse)).toBeTruthy();
    const data = batchResponse[0];
    expect(data).toHaveProperty("result");
    expect(data.result).toHaveProperty("data");
    expect(data.result.data).toHaveProperty("json");

    const runs = data.result.data.json;
    expect(Array.isArray(runs)).toBeTruthy();

    // If runs are returned, verify all of them have the "test" tag
    if (runs.length > 0) {
      for (const run of runs) {
        expect(run.tags).toContain("test");
      }
    }
  });

  test("should call tRPC list-runs with tag filter", async ({ page, request }) => {
    // Navigate to authenticated page
    await page.goto(`/o/${orgSlug}/projects`);
    await page.waitForLoadState("networkidle");

    // Get session cookie
    const cookies = await page.context().cookies();
    const sessionCookie = cookies.find(c => c.name === "better-auth.session_token");

    if (!sessionCookie) {
      test.skip();
      return;
    }

    // Get the organizationId from the auth endpoint
    const authUrl = `${serverUrl}/trpc/auth?batch=1&input=${encodeURIComponent(
      JSON.stringify({
        "0": {
          "json": null
        }
      })
    )}`;

    const authResponse = await request.get(authUrl, {
      headers: {
        "Cookie": `${sessionCookie.name}=${sessionCookie.value}`,
      },
    });

    expect(authResponse.ok()).toBeTruthy();
    const authData = await authResponse.json();
    const organizationId = authData[0]?.result?.data?.json?.activeOrganization?.id;
    expect(organizationId).toBeDefined();

    // Call tRPC list-runs with tag filter
    // tRPC v11 uses batch format for requests
    const trpcUrl = `${serverUrl}/trpc/runs.list?batch=1&input=${encodeURIComponent(
      JSON.stringify({
        "0": {
          "json": {
            organizationId,
            projectName,
            tags: ["test"],
            limit: 10,
          }
        }
      })
    )}`;

    const trpcResponse = await request.get(trpcUrl, {
      headers: {
        "Cookie": `${sessionCookie.name}=${sessionCookie.value}`,
      },
    });

    expect(trpcResponse.ok()).toBeTruthy();
    const batchResponse = await trpcResponse.json();
    console.log("List runs response:", batchResponse);

    // tRPC batch response format: array with results
    expect(Array.isArray(batchResponse)).toBeTruthy();
    const data = batchResponse[0];
    expect(data).toHaveProperty("result");
    expect(data.result).toHaveProperty("data");
    expect(data.result.data).toHaveProperty("json");
    expect(data.result.data.json).toHaveProperty("runs");

    const runs = data.result.data.json.runs;
    expect(Array.isArray(runs)).toBeTruthy();

    // If runs are returned, verify all of them have the "test" tag
    if (runs.length > 0) {
      for (const run of runs) {
        expect(run.tags).toContain("test");
      }
    }
  });
});
