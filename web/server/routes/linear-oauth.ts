import { Hono } from "hono";
import { decrypt, encrypt } from "../lib/encryption";
import { exchangeCodeForTokens } from "../lib/linear-oauth";
import { validateApiKey } from "../lib/linear-client";
import { prisma } from "../lib/prisma";
import { env } from "../lib/env";

const app = new Hono();

interface OAuthState {
  organizationId: string;
  userId: string;
  redirectUrl: string;
  exp?: number;
}

/**
 * GET /api/integrations/linear/callback
 *
 * Linear redirects here after the user authorizes the OAuth app.
 * The `state` parameter is an encrypted JSON payload that ties the
 * callback to a specific org/user.
 */
app.get("/linear/callback", async (c) => {
  const code = c.req.query("code");
  const stateParam = c.req.query("state");

  if (!code || !stateParam) {
    return c.text("Missing code or state parameter", 400);
  }

  // Decrypt and validate the state
  let state: OAuthState;
  try {
    state = JSON.parse(decrypt(stateParam)) as OAuthState;
  } catch {
    return c.text("Invalid or expired state parameter", 400);
  }

  if (!state.organizationId || !state.userId || !state.redirectUrl) {
    return c.text("Malformed state parameter", 400);
  }

  // Check expiry if present
  if (state.exp && Date.now() > state.exp) {
    return c.text("State parameter has expired, please try again", 400);
  }

  // Exchange the authorization code for tokens
  let tokens;
  try {
    tokens = await exchangeCodeForTokens(code);
  } catch (err) {
    console.error("[linear-oauth] token exchange failed:", err);
    return c.text("Failed to exchange authorization code", 500);
  }

  // Validate the token by fetching workspace info
  let viewer;
  try {
    viewer = await validateApiKey(tokens.access_token);
  } catch (err) {
    console.error("[linear-oauth] token validation failed:", err);
    return c.text("Failed to validate Linear access token", 500);
  }

  // Upsert the integration record, merging config to preserve any extra fields
  const now = Date.now();
  const existing = await prisma.integration.findUnique({
    where: {
      organizationId_provider: {
        organizationId: state.organizationId,
        provider: "linear",
      },
    },
    select: { config: true },
  });
  const existingConfig = (existing?.config ?? {}) as Record<string, unknown>;

  const newConfig = {
    ...existingConfig,
    workspaceSlug: viewer.organization.urlKey,
    workspaceName: viewer.organization.name,
    encryptedRefreshToken: encrypt(tokens.refresh_token),
    expiresAt: now + tokens.expires_in * 1000,
  };

  await prisma.integration.upsert({
    where: {
      organizationId_provider: {
        organizationId: state.organizationId,
        provider: "linear",
      },
    },
    update: {
      encryptedToken: encrypt(tokens.access_token),
      enabled: true,
      config: newConfig,
    },
    create: {
      organizationId: state.organizationId,
      provider: "linear",
      encryptedToken: encrypt(tokens.access_token),
      enabled: true,
      config: newConfig,
      metadata: {},
      createdById: state.userId,
    },
  });

  console.log(`[linear-oauth] connected org=${state.organizationId} workspace=${viewer.organization.urlKey}`);

  // Redirect back to the integration settings page
  return c.redirect(state.redirectUrl);
});

export default app;
