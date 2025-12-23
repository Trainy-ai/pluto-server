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

export const withApiKey = async (c: Context, next: () => Promise<void>) => {
  // Format: Authorization: Bearer <apiKey>
  const authorizationKey = c.req.header("Authorization")?.split(" ")[1];

  console.log("authorizationKey", authorizationKey);

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
