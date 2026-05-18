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
