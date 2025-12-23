import { trpcServer } from "@hono/trpc-server";
import { Hono } from "hono";
import { cors } from "hono/cors";

import { createContext } from "./lib/context";
import { appRouter } from "./trpc/router";
import { prisma } from "./lib/prisma";
import { env } from "./lib/env";

import healthRoutes from "./routes/health";
import runRoutes from "./routes/runs";
import authRoutes from "./routes/auth";
import { withApiKey } from "./routes/middleware";

const app = new Hono();

// Add prisma to Hono context type
declare module "hono" {
  interface ContextVariableMap {
    prisma: typeof prisma;
  }
}

// Apply CORS middleware first
app.use(
  "/*",
  cors({
    origin: [env.PUBLIC_URL, env.BETTER_AUTH_URL],
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowHeaders: [
      "Content-Type",
      "Authorization",
      "trpc-accept",
      "trpc-batch-mode",
      "Access-Control-Allow-Origin",
      "Access-Control-Allow-Headers",
      "Access-Control-Allow-Methods",
    ],
    credentials: true,
    exposeHeaders: ["Content-Type", "Transfer-Encoding"],
    maxAge: 86400,
  })
);

// Add prisma to context
app.use("*", async (c, next) => {
  c.set("prisma", prisma);
  await next();
});

// Mount routes
app.route("/api", healthRoutes);
app.route("/api/runs", runRoutes);
app.route("/api/auth", authRoutes);

app.use(
  "/trpc/*",
  trpcServer({
    router: appRouter,
    createContext: (_opts, hono) => {
      return createContext({
        hono,
      });
    },
  })
);

app.post("/api/slug", withApiKey, async (c) => {
  const apiKey = c.get("apiKey");
  return c.json({
    organization: {
      slug: apiKey.organization.slug,
    },
  });
});

export default app;
