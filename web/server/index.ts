import { trpcServer } from "@hono/trpc-server";
import { swaggerUI } from "@hono/swagger-ui";
import { OpenAPIHono, z } from "@hono/zod-openapi";
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
import { FIELD_FILTER_OPERATORS } from "./trpc/routers/runs/procs/list-runs";
import {
  RUN_FILTER_BOOLEAN_OPERATORS,
  RUN_FILTER_LEAF_OPERATORS,
  RUN_FILTER_FIELDS,
  RUN_FILTER_FIELD_PREFIXES,
} from "./lib/queries/run-filter-grammar";
import authRoutes from "./routes/auth";
import chartDataRoutes from "./routes/chart-data";
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
app.route("/api/chart-data", chartDataRoutes);

app.use(
  "/trpc/*",
  trpcServer({
    router: appRouter,
    // Allow query procedures to be invoked over POST. The client's
    // httpBatchStreamLink falls back from GET to POST when a single
    // op's encoded input would push the URL over MAX_URL_LENGTH
    // (8 KB) — typical for grouped chart queries on large run
    // selections — and without this flag the server rejects with
    // "Unsupported POST-request to query procedure" (HTTP 405).
    allowMethodOverride: true,
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

// Publish the field-filter term shape as a named OpenAPI component so REST
// clients can read the supported source/dataType/operator enums. This is a
// doc-only schema: the runtime `fieldFilterSchema` keeps `operator: z.string()`
// (it's shared with the tRPC/web-app inputs that type operators as plain
// strings), while the published component carries the full operator enum.
const FieldFilterTermDoc = z.object({
  source: z.enum(["config", "systemMetadata"]),
  key: z.string(),
  dataType: z.enum(["text", "number", "date", "option"]),
  operator: z.enum(FIELD_FILTER_OPERATORS),
  values: z.array(z.any()),
});
app.openAPIRegistry.register("FieldFilterTerm", FieldFilterTermDoc);

// Publish the wandb-style `filter` query grammar (the canonical vocabulary from
// lib/queries/run-filter-grammar.ts) as a machine-readable OpenAPI component, so
// the Pluto client and docs can contract-test their own copies against it and
// drift fails CI. Doc-only: the runtime compiler validates against the same
// consts directly.
const RunFilterGrammarDoc = z.object({
  booleanOperators: z.array(z.enum(RUN_FILTER_BOOLEAN_OPERATORS)),
  leafOperators: z.array(z.enum(RUN_FILTER_LEAF_OPERATORS)),
  fields: z.array(z.enum(RUN_FILTER_FIELDS)),
  fieldPrefixes: z.array(z.enum(RUN_FILTER_FIELD_PREFIXES)),
});
app.openAPIRegistry.register("RunFilterGrammar", RunFilterGrammarDoc);

// Swagger UI
app.get("/api/docs", swaggerUI({ url: "/api/openapi.json" }));

export default app;
