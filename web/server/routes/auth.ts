import { Hono } from "hono";
import { auth } from "../lib/auth";
import { withApiKey } from "./middleware";

const router = new Hono();

type BlockedWildcard = `/${string}`;

const BLOCKED_WILDCARDS: BlockedWildcard[] = [];

router.on(["POST", "GET"], "/*", (c) => {
  const path = c.req.path;
  if (BLOCKED_WILDCARDS.some((blocked) => path.includes(blocked))) {
    return c.json({ error: "Unauthorized path" }, 403);
  }
  return auth.handler(c.req.raw);
});

export default router;
