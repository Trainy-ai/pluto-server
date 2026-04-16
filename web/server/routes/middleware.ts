import type { Context } from "hono";
import {
  INSECURE_API_KEY_PREFIX,
  SECURE_API_KEY_PREFIX,
  keyToSearchFor,
} from "../lib/api-key";

export type ApiKey = {
  id: string;
  key: string;
  organization: {
    id: string;
    slug: string;
  };
  user: {
    id: string;
  };
};

declare module "hono" {
  interface ContextVariableMap {
    apiKey: ApiKey;
  }
}

/**
 * Parse `Authorization: Bearer <apiKey>` and resolve it to an ApiKey record.
 * Returns null on any failure (missing header, malformed prefix, not found).
 *
 * Use this in endpoints that support MULTIPLE auth modes (e.g., session OR
 * API key) — the caller decides what to do with a null result. For endpoints
 * where API key is the only auth mode, use the `withApiKey` middleware, which
 * short-circuits with a 401 on failure.
 */
export const resolveApiKey = async (c: Context): Promise<ApiKey | null> => {
  const authorizationKey = c.req.header("Authorization")?.split(" ")[1];
  if (!authorizationKey) {
    return null;
  }
  if (
    !authorizationKey.startsWith(SECURE_API_KEY_PREFIX) &&
    !authorizationKey.startsWith(INSECURE_API_KEY_PREFIX)
  ) {
    return null;
  }
  const key = await keyToSearchFor(authorizationKey);
  const apiKey = await c.get("prisma").apiKey.findFirst({
    where: { key },
    include: {
      organization: { select: { id: true, slug: true } },
      user: { select: { id: true } },
    },
  });
  return apiKey;
};

export const withApiKey = async (c: Context, next: () => Promise<void>) => {
  // Format: Authorization: Bearer <apiKey>
  const authorizationKey = c.req.header("Authorization")?.split(" ")[1];

  if (!authorizationKey) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  if (
    !authorizationKey?.startsWith(SECURE_API_KEY_PREFIX) &&
    !authorizationKey?.startsWith(INSECURE_API_KEY_PREFIX)
  ) {
    return c.json({ error: "Unauthorized", message: "Invalid API key" }, 401);
  }

  const key = await keyToSearchFor(authorizationKey);
  const apiKey = await c.get("prisma").apiKey.findFirst({
    where: { key },
    include: {
      organization: {
        select: {
          id: true,
          slug: true,
        },
      },
      user: {
        select: {
          id: true,
        },
      },
    },
  });

  if (!apiKey) {
    return c.json({ error: "Unauthorized", message: "Key not found" }, 401);
  }

  c.set("apiKey", apiKey);
  await next();
};
