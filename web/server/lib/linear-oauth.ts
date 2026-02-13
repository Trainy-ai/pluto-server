import type { PrismaClient } from "@prisma/client";
import { encrypt, decrypt } from "./encryption";
import { env } from "./env";

const LINEAR_TOKEN_URL = "https://api.linear.app/oauth/token";
const LINEAR_AUTHORIZE_URL = "https://linear.app/oauth/authorize";

/** Buffer before expiry when we proactively refresh (5 minutes). */
const REFRESH_BUFFER_MS = 5 * 60 * 1000;

/**
 * Per-org lock to prevent concurrent token refresh races.
 * If a refresh is already in progress for an org, subsequent callers
 * await the same promise instead of starting a new refresh.
 */
const refreshLocks = new Map<string, Promise<string>>();

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
  scope: string[];
}

function requireOAuthConfig() {
  if (!env.LINEAR_OAUTH_CLIENT_ID || !env.LINEAR_OAUTH_CLIENT_SECRET) {
    throw new Error("LINEAR_OAUTH_CLIENT_ID and LINEAR_OAUTH_CLIENT_SECRET must be set");
  }
  return {
    clientId: env.LINEAR_OAUTH_CLIENT_ID,
    clientSecret: env.LINEAR_OAUTH_CLIENT_SECRET,
  };
}

function getRedirectUri(): string {
  return `${env.PUBLIC_URL}/api/integrations/linear/callback`;
}

/**
 * Build the Linear OAuth authorization URL.
 * @param state Encrypted state parameter for CSRF protection.
 */
export function getLinearOAuthUrl(state: string): string {
  const { clientId } = requireOAuthConfig();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: getRedirectUri(),
    response_type: "code",
    scope: "read,write",
    state,
    actor: "app",
    prompt: "consent",
  });
  return `${LINEAR_AUTHORIZE_URL}?${params.toString()}`;
}

/**
 * Exchange an authorization code for access + refresh tokens.
 */
export async function exchangeCodeForTokens(code: string): Promise<TokenResponse> {
  const { clientId, clientSecret } = requireOAuthConfig();

  const response = await fetch(LINEAR_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: getRedirectUri(),
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Linear token exchange failed: ${response.status} ${text.slice(0, 500)}`);
  }

  return (await response.json()) as TokenResponse;
}

/**
 * Use a refresh token to obtain a new access token.
 */
export async function refreshAccessToken(refreshToken: string): Promise<TokenResponse> {
  const { clientId, clientSecret } = requireOAuthConfig();

  const response = await fetch(LINEAR_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Linear token refresh failed: ${response.status} ${text.slice(0, 500)}`);
  }

  return (await response.json()) as TokenResponse;
}

/**
 * Get a valid Linear access token for the given organization.
 * For OAuth integrations, automatically refreshes expired tokens.
 * For legacy API key integrations, returns the decrypted key as-is.
 * Uses a per-org lock to prevent concurrent refresh races.
 */
export async function getValidToken(prisma: PrismaClient, organizationId: string): Promise<string> {
  const integration = await (prisma as any).integration.findUnique({
    where: {
      organizationId_provider: {
        organizationId,
        provider: "linear",
      },
    },
  });

  if (!integration || !integration.enabled) {
    throw new Error("Linear integration not configured or disabled");
  }

  const config = (integration.config ?? {}) as Record<string, unknown>;
  const encryptedRefreshToken = config.encryptedRefreshToken as string | undefined;

  // Legacy API key integration — no refresh token, just decrypt and return
  if (!encryptedRefreshToken) {
    return decrypt(integration.encryptedToken);
  }

  // OAuth integration — check expiry and refresh if needed
  const expiresAt = config.expiresAt as number | undefined;
  const now = Date.now();

  if (expiresAt && expiresAt - now > REFRESH_BUFFER_MS) {
    // Token is still fresh
    return decrypt(integration.encryptedToken);
  }

  // Token is expired or expiring soon — use per-org lock to prevent concurrent refreshes
  const existing = refreshLocks.get(organizationId);
  if (existing) {
    return existing;
  }

  const refreshPromise = doRefresh(prisma, organizationId, config, encryptedRefreshToken);
  refreshLocks.set(organizationId, refreshPromise);
  try {
    return await refreshPromise;
  } finally {
    refreshLocks.delete(organizationId);
  }
}

async function doRefresh(
  prisma: PrismaClient,
  organizationId: string,
  config: Record<string, unknown>,
  encryptedRefreshToken: string,
): Promise<string> {
  const expiresAt = config.expiresAt as number | undefined;
  console.log(`[linear-oauth] refreshing token for org=${organizationId} (expires=${expiresAt ? new Date(expiresAt).toISOString() : "unknown"})`);
  const refreshToken = decrypt(encryptedRefreshToken);
  const tokens = await refreshAccessToken(refreshToken);
  const now = Date.now();

  // Save the new tokens
  await (prisma as any).integration.update({
    where: {
      organizationId_provider: {
        organizationId,
        provider: "linear",
      },
    },
    data: {
      encryptedToken: encrypt(tokens.access_token),
      config: {
        ...config,
        encryptedRefreshToken: encrypt(tokens.refresh_token),
        expiresAt: now + tokens.expires_in * 1000,
      },
    },
  });

  return tokens.access_token;
}
