import { nanoid } from "nanoid";

export const SECURE_API_KEY_PREFIX = "mlps_";
export const INSECURE_API_KEY_PREFIX = "mlpi_";

export const generateApiKey = (secure: boolean) => {
  return `${secure ? SECURE_API_KEY_PREFIX : INSECURE_API_KEY_PREFIX}${nanoid(
    secure ? 24 : 16
  )}`;
};

export const apiKeyToStore = async (apiKey: string) => {
  if (apiKey.startsWith(SECURE_API_KEY_PREFIX)) {
    const hashBuffer = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(apiKey)
    );
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  return apiKey;
};

export const keyToSearchFor = async (userInputApiKey: string) => {
  if (userInputApiKey.startsWith(SECURE_API_KEY_PREFIX)) {
    const hashBuffer = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(userInputApiKey)
    );
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  if (userInputApiKey.startsWith(INSECURE_API_KEY_PREFIX)) {
    return userInputApiKey;
  }

  throw new Error("Invalid API key");
};

export const createKeyString = (apiKey: string) => {
  // if the api key is secure, then keep the start mlps_x*****xx first and last 2 characters
  if (apiKey.startsWith(SECURE_API_KEY_PREFIX)) {
    const numStars = apiKey.length - 5 - 2;
    const stars = "*".repeat(numStars);
    return apiKey.slice(0, 6) + stars + apiKey.slice(-2);
  }

  return apiKey;
};

/**
 * An API key is expired once its `expiresAt` instant has passed.
 *
 * `expiresAt` from Prisma is a `Date` — an absolute instant (UTC epoch
 * milliseconds). Comparing `.getTime()` against `Date.now()` compares two
 * absolute instants, so the result is timezone-independent: it does not
 * depend on the timezone of the server, the database, or whoever created
 * the key. A null/undefined `expiresAt` means the key never expires.
 *
 * This mirrors the ingest service's check (`expires_at < Utc::now()` in
 * ingest/src/db.rs), so both services agree on the exact expiry instant.
 */
export const isApiKeyExpired = (
  expiresAt: Date | null | undefined
): boolean => expiresAt != null && expiresAt.getTime() < Date.now();

/**
 * An API key is revoked once it has a `revokedAt` timestamp. Revocation is a
 * soft delete — the row is kept so runs created with the key (which reference
 * it via the required `Runs.creatorApiKeyId` FK) stay intact. A revoked key
 * must be rejected everywhere a key is authenticated.
 *
 * This mirrors the ingest service's check (`revoked_at IS NOT NULL` in
 * ingest/src/db.rs), so both services agree on which keys are usable.
 */
export const isApiKeyRevoked = (
  revokedAt: Date | null | undefined
): boolean => revokedAt != null;

/**
 * Prisma `where` matching the API keys of an organization that can still
 * authenticate: not revoked, and not past their expiry.
 *
 * Revocation and expiry are both enforced at authentication time (see
 * routes/middleware.ts and ingest/src/db.rs), so a key failing either test is
 * dead everywhere. Listing one next to live keys therefore misrepresents an
 * organization's real access surface — it reads as a credential someone still
 * holds. Anything that shows keys to a human should filter with this.
 *
 * `now` is injectable so callers (and tests) can pin the instant; it defaults
 * to the current one.
 */
export const liveApiKeyWhere = (organizationId: string, now: Date = new Date()) => ({
  organizationId,
  revokedAt: null,
  OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
});
