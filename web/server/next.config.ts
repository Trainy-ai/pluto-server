import { env } from "./lib/env";

// Security headers for the one surface Hono does not cover.
//
// The Hono app is mounted through the app/[...route] catch-all, which matches
// every path except the root — so `GET /` falls through to Next's built-in 404
// document and misses the secureHeaders middleware in index.ts entirely. That
// exact URL (https://pluto-api-dev.trainy.ai/) is named in GRSee finding 3.2,
// so it has to carry the same headers the API tier already sends.
//
// Scoped to "/" deliberately: every other path — including /_next/static/* —
// is served by Hono, which already sets these. A catch-all source here would
// risk fighting the deliberately looser /api/docs CSP that Swagger UI needs.
//
// The CSP matches the API tier's strictest policy verbatim. The only thing
// Next serves on "/" is its stock 404 page, whose script/style references
// already resolve to Hono 404s in this deployment, so "default-src 'none'"
// costs nothing here.
const securityHeaders = [
  {
    key: "Content-Security-Policy",
    value: "default-src 'none'; frame-ancestors 'none'",
  },
  {
    key: "Strict-Transport-Security",
    value: "max-age=31536000; includeSubDomains",
  },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=()",
  },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: env.IS_DOCKER === "true" ? "standalone" : undefined,
  // Drop the "x-powered-by: Next.js" framework disclosure (GRSee 3.2).
  poweredByHeader: false,
  async headers() {
    return [{ source: "/", headers: securityHeaders }];
  },
};

export default nextConfig;
