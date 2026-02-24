import { trpcServer } from "@hono/trpc-server";
import { swaggerUI } from "@hono/swagger-ui";
import { OpenAPIHono } from "@hono/zod-openapi";
import { cors } from "hono/cors";
import { compress } from "hono/compress";
import { HTTPException } from "hono/http-exception";

import { createContext } from "./lib/context";
import { appRouter } from "./trpc/router";
import { prisma } from "./lib/prisma";
import { env } from "./lib/env";
import { allowedOrigins } from "./lib/origins";

import healthRoutes from "./routes/health";
import versionRoutes from "./routes/version";
import runRoutes from "./routes/runs-openapi";
import authRoutes from "./routes/auth";
import stripeWebhookRoutes from "./routes/stripe-webhook";
import linearOAuthRoutes from "./routes/linear-oauth";
import { withApiKey } from "./routes/middleware";

const app = new OpenAPIHono();

// Add prisma to Hono context type
declare module "hono" {
  interface ContextVariableMap {
    prisma: typeof prisma;
  }
}

// Apply CORS middleware first — must run before compress so that
// CORS headers are present even when compression fails or errors occur.
app.use(
  "/*",
  cors({
    origin: allowedOrigins,
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

// Apply gzip compression to reduce JSON payload sizes
app.use("/*", compress());

// Global error handler — ensures CORS headers are present on error responses
// so the browser doesn't mask the real error with an opaque CORS failure.
app.onError((err, c) => {
  const origin = c.req.header("Origin");
  if (origin && allowedOrigins.includes(origin)) {
    c.header("Access-Control-Allow-Origin", origin);
    c.header("Access-Control-Allow-Credentials", "true");
  }

  if (err instanceof HTTPException) {
    return c.json({ error: err.message }, err.status);
  }

  console.error(`[${c.req.method}] ${c.req.path}:`, err);
  return c.json({ error: "Internal Server Error" }, 500);
});

// Add prisma to context
app.use("*", async (c, next) => {
  c.set("prisma", prisma);
  await next();
});

// Mount routes
app.route("/api", healthRoutes);
app.route("/api", versionRoutes);
app.route("/api/runs", runRoutes);
app.route("/api/auth", authRoutes);
app.route("/api/stripe", stripeWebhookRoutes);
app.route("/api/integrations", linearOAuthRoutes);

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

// OpenAPI documentation
app.doc("/api/openapi.json", {
  openapi: "3.0.0",
  info: {
    title: "mlop API",
    version: "1.0.0",
    description: "API for mlop - ML experiment tracking platform",
  },
  servers: [
    { url: env.PUBLIC_URL, description: "API Server" },
  ],
  security: [{ bearerAuth: [] }],
});

// Register security scheme
app.openAPIRegistry.registerComponent("securitySchemes", "bearerAuth", {
  type: "http",
  scheme: "bearer",
  bearerFormat: "API Key",
  description: "API key obtained from the mlop dashboard",
});

// Swagger UI
app.get("/api/docs", swaggerUI({ url: "/api/openapi.json" }));

export default app;
