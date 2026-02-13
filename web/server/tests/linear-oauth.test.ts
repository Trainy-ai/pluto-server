/**
 * Linear OAuth Tests
 *
 * Tests OAuth URL generation, token exchange, token refresh, and getValidToken logic.
 * All external dependencies (env, encryption, fetch) are mocked.
 *
 * Run with: cd web && pnpm --filter @mlop/server exec vitest run tests/linear-oauth.test.ts
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../lib/env", () => ({
  env: {
    LINEAR_OAUTH_CLIENT_ID: "test-client-id",
    LINEAR_OAUTH_CLIENT_SECRET: "test-client-secret",
    PUBLIC_URL: "http://localhost:3001",
    BETTER_AUTH_URL: "http://localhost:3000",
  },
}));

vi.mock("../lib/encryption", () => ({
  encrypt: vi.fn((text: string) => `encrypted:${text}`),
  decrypt: vi.fn((text: string) => text.replace("encrypted:", "")),
}));

import { getLinearOAuthUrl, exchangeCodeForTokens, refreshAccessToken, getValidToken } from "../lib/linear-oauth";
import { encrypt, decrypt } from "../lib/encryption";

beforeEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe("getLinearOAuthUrl", () => {
  it("should build a valid OAuth authorization URL", () => {
    const url = getLinearOAuthUrl("encrypted-state");
    const parsed = new URL(url);

    expect(parsed.origin).toBe("https://linear.app");
    expect(parsed.pathname).toBe("/oauth/authorize");
    expect(parsed.searchParams.get("client_id")).toBe("test-client-id");
    expect(parsed.searchParams.get("redirect_uri")).toBe(
      "http://localhost:3001/api/integrations/linear/callback"
    );
    expect(parsed.searchParams.get("response_type")).toBe("code");
    expect(parsed.searchParams.get("scope")).toBe("read,write");
    expect(parsed.searchParams.get("state")).toBe("encrypted-state");
    expect(parsed.searchParams.get("actor")).toBe("app");
    expect(parsed.searchParams.get("prompt")).toBe("consent");
  });
});

describe("exchangeCodeForTokens", () => {
  it("should exchange code for tokens", async () => {
    const mockResponse = {
      access_token: "access-123",
      refresh_token: "refresh-456",
      expires_in: 86400,
      token_type: "Bearer",
      scope: ["read", "write"],
    };

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(mockResponse), { status: 200 })
    );

    const result = await exchangeCodeForTokens("auth-code-xyz");

    expect(result.access_token).toBe("access-123");
    expect(result.refresh_token).toBe("refresh-456");
    expect(result.expires_in).toBe(86400);

    // Verify the fetch call
    const call = vi.mocked(fetch).mock.calls[0];
    expect(call[0]).toBe("https://api.linear.app/oauth/token");
    const body = new URLSearchParams(call[1]!.body as string);
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("code")).toBe("auth-code-xyz");
    expect(body.get("client_id")).toBe("test-client-id");
    expect(body.get("client_secret")).toBe("test-client-secret");
  });

  it("should throw on non-200 response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("invalid_grant", { status: 400 })
    );

    await expect(exchangeCodeForTokens("bad-code")).rejects.toThrow(
      "Linear token exchange failed: 400"
    );
  });
});

describe("refreshAccessToken", () => {
  it("should refresh the access token", async () => {
    const mockResponse = {
      access_token: "new-access-789",
      refresh_token: "new-refresh-012",
      expires_in: 86400,
      token_type: "Bearer",
      scope: ["read", "write"],
    };

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(mockResponse), { status: 200 })
    );

    const result = await refreshAccessToken("old-refresh-token");

    expect(result.access_token).toBe("new-access-789");
    expect(result.refresh_token).toBe("new-refresh-012");

    const call = vi.mocked(fetch).mock.calls[0];
    const body = new URLSearchParams(call[1]!.body as string);
    expect(body.get("grant_type")).toBe("refresh_token");
    expect(body.get("refresh_token")).toBe("old-refresh-token");
  });

  it("should throw on non-200 response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("invalid_token", { status: 401 })
    );

    await expect(refreshAccessToken("expired-token")).rejects.toThrow(
      "Linear token refresh failed: 401"
    );
  });
});

describe("getValidToken", () => {
  function createMockPrisma(integration: unknown) {
    return {
      integration: {
        findUnique: vi.fn().mockResolvedValue(integration),
        update: vi.fn().mockResolvedValue({}),
      },
    } as any;
  }

  it("should return decrypted token for legacy API key integration (no refresh token)", async () => {
    const prisma = createMockPrisma({
      enabled: true,
      encryptedToken: "encrypted:legacy-api-key",
      config: { workspaceSlug: "my-ws", workspaceName: "My Workspace" },
    });

    const token = await getValidToken(prisma, "org-1");
    expect(token).toBe("legacy-api-key");
    expect(decrypt).toHaveBeenCalledWith("encrypted:legacy-api-key");
  });

  it("should return cached token when OAuth token is not expired", async () => {
    const futureExpiry = Date.now() + 60 * 60 * 1000; // 1 hour from now
    const prisma = createMockPrisma({
      enabled: true,
      encryptedToken: "encrypted:fresh-access-token",
      config: {
        encryptedRefreshToken: "encrypted:refresh-token",
        expiresAt: futureExpiry,
      },
    });

    const token = await getValidToken(prisma, "org-1");
    expect(token).toBe("fresh-access-token");
    // Should NOT have called fetch (no refresh needed)
    expect(prisma.integration.update).not.toHaveBeenCalled();
  });

  it("should refresh token when OAuth token is about to expire", async () => {
    const nearExpiry = Date.now() + 2 * 60 * 1000; // 2 minutes (within 5-min buffer)
    const prisma = createMockPrisma({
      enabled: true,
      encryptedToken: "encrypted:old-access-token",
      config: {
        encryptedRefreshToken: "encrypted:old-refresh-token",
        expiresAt: nearExpiry,
      },
    });

    // Mock the token refresh
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          access_token: "new-access-token",
          refresh_token: "new-refresh-token",
          expires_in: 86400,
        }),
        { status: 200 }
      )
    );

    const token = await getValidToken(prisma, "org-1");
    expect(token).toBe("new-access-token");

    // Should have saved the new tokens to DB
    expect(prisma.integration.update).toHaveBeenCalledOnce();
    expect(encrypt).toHaveBeenCalledWith("new-access-token");
    expect(encrypt).toHaveBeenCalledWith("new-refresh-token");
  });

  it("should throw when integration not found", async () => {
    const prisma = createMockPrisma(null);
    await expect(getValidToken(prisma, "org-1")).rejects.toThrow(
      "not configured or disabled"
    );
  });

  it("should throw when integration is disabled", async () => {
    const prisma = createMockPrisma({
      enabled: false,
      encryptedToken: "encrypted:token",
      config: {},
    });
    await expect(getValidToken(prisma, "org-1")).rejects.toThrow(
      "not configured or disabled"
    );
  });
});
