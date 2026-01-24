import { trpcServer } from "@hono/trpc-server";
import { swaggerUI } from "@hono/swagger-ui";
import { OpenAPIHono } from "@hono/zod-openapi";
import { cors } from "hono/cors";

import { createContext } from "./lib/context";
import { appRouter } from "./trpc/router";
import { prisma } from "./lib/prisma";
import { env } from "./lib/env";

import healthRoutes from "./routes/health";
import versionRoutes from "./routes/version";
import runRoutes from "./routes/runs-openapi";
import authRoutes from "./routes/auth";
import { withApiKey } from "./routes/middleware";

const app = new OpenAPIHono();

// Add prisma to Hono context type
declare module "hono" {
  interface ContextVariableMap {
    prisma: typeof prisma;
  }
}

// Build allowed origins list for CORS
const allowedOrigins = [env.PUBLIC_URL, env.BETTER_AUTH_URL];
if (env.ADDITIONAL_ORIGINS) {
  allowedOrigins.push(...env.ADDITIONAL_ORIGINS.split(",").map((s) => s.trim()));
}

// Apply CORS middleware first
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
