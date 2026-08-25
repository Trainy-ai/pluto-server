import tailwindcss from "@tailwindcss/vite";
import { TanStackRouterVite } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { execFile } from "child_process";
import fs from "fs";
import path from "path";
import { defineConfig, type Plugin } from "vite";

// Python Panels sandbox CSP — mirror of the headers nginx.conf adds in
// production for /stlite/panel-host.html. Keep the two in sync.
// script-src data: is required: stlite embeds its worker as a data: URL
// that its blob wrapper importScripts. Isolation comes from connect-src.
const PANEL_HOST_CSP = [
  "default-src 'none'",
  "script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval' blob: data:",
  "connect-src 'self'",
  "worker-src blob:",
  "img-src blob: data: *",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
].join("; ");

/**
 * Dev-server mirror of the production nginx headers for /stlite/*: the
 * sandboxed panel iframe has an opaque origin, so every asset fetch is
 * cross-origin and needs ACAO; the host page additionally gets the CSP.
 */
function panelAssetHeaders(): Plugin {
  return {
    name: "mlop-panel-asset-headers",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url?.split("?")[0] ?? "";
        if (url.startsWith("/stlite/")) {
          res.setHeader("Access-Control-Allow-Origin", "*");
          if (url === "/stlite/panel-host.html") {
            res.setHeader("Content-Security-Policy", PANEL_HOST_CSP);
          }
        }
        next();
      });
    },
  };
}

/**
 * Vendor the Python Panels runtime (stlite + Pyodide) for dev and build.
 *
 * public/stlite/{stlite,pyodide}/ is git-ignored — only panel-host.{html,js}
 * are tracked — and fetch-panel-assets.mjs was wired into web/app/Dockerfile
 * alone. Every path that runs vite directly (Vercel's `vite build`, the
 * Buildkite E2E stack, plain `pnpm dev:*`) served the panel host page with no
 * runtime behind it, so `import("./stlite/stlite.js")` 404'd and the sandbox
 * reported a boot error instead of rendering.
 *
 * Build blocks on the fetch — the bundle is wrong without it. Dev must add
 * nothing to startup: a cold fetch is ~45MB, and CI's readiness probe allows
 * the dev server only ~2s before declaring "Frontend failed to start" (doing
 * this eagerly took down all three E2E shards in build 3431). So dev fetches
 * lazily, on the first /stlite/ request — the only thing that needs the
 * runtime — and the panel specs' 120s boot budget covers a cold fetch.
 *
 * A warm tree costs ~0.1s (sha256 check, no downloads). SKIP_PANEL_ASSETS=1
 * opts out entirely.
 */
function panelAssets(): Plugin {
  const script = path.resolve(__dirname, "scripts/fetch-panel-assets.mjs");
  let running: Promise<void> | null = null;
  const fetchAssets = () => {
    if (running) {
      return running;
    }
    if (process.env.SKIP_PANEL_ASSETS === "1" || !fs.existsSync(script)) {
      running = Promise.resolve();
      return running;
    }
    running = new Promise<void>((resolve, reject) => {
      execFile("node", [script], (err, stdout, stderr) => {
        process.stdout.write(stdout);
        process.stderr.write(stderr);
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
    return running;
  };
  let isServe = false;
  return {
    name: "mlop-panel-assets",
    configResolved(config) {
      isServe = config.command === "serve";
    },
    // Bundling must not start before the assets are on disk to be copied.
    // Vite fires buildStart in dev too, so serve mode opts out here and
    // defers to the middleware below — otherwise "lazy" is a lie and the
    // dev server blocks on the fetch after all.
    buildStart: () => (isServe ? undefined : fetchAssets()),
    configureServer(server) {
      // Kick the fetch off at server start but DO NOT await it. Vite has to
      // listen immediately — CI's readiness probe allows the dev server
      // roughly 2s before declaring "Frontend failed to start", and
      // .buildkite/pipeline.yml is a rule-protected path we cannot widen
      // that budget in — while the ~45MB cold download overlaps the minutes
      // of Playwright install and auth setup that follow it.
      //
      // Fetching only on the first /stlite/ hit is too late: the panel
      // iframe's `import("./stlite/stlite.js")` fails with "Failed to fetch
      // dynamically imported module" long before a cold fetch lands, and
      // the stalled request starves the same dev server the page's tRPC
      // calls proxy through. Reproduced locally against a cold tree.
      void fetchAssets().catch(() => {
        // Surfaced by the middleware below, on the request that needs it.
      });
      server.middlewares.use((req, res, next) => {
        if (!(req.url ?? "").startsWith("/stlite/")) {
          next();
          return;
        }
        fetchAssets().then(
          () => next(),
          (err) => {
            server.config.logger.error(
              `[mlop-panel-assets] failed to vendor the panel runtime: ${err}`,
            );
            next();
          },
        );
      });
    },
  };
}

const portOffset = parseInt(process.env.PORT_OFFSET || '0', 10);
const appPort = 3000 + portOffset;
const serverUrl = process.env.VITE_SERVER_URL || (portOffset
  ? `http://localhost:${3001 + portOffset}`
  : 'http://server:3001');

export default defineConfig({
  appType: 'spa', // Enable SPA mode for client-side routing
  plugins: [
    tailwindcss(),
    TanStackRouterVite({
      routeFileIgnorePrefix: "~",
      autoCodeSplitting: true,
    }),
    react(),
    panelAssets(),
    panelAssetHeaders(),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    host: true,
    port: appPort,
    strictPort: false,
    hmr: false, // Disable HMR in Docker to avoid WebSocket issues
    cors: true,
    allowedHosts: ['app'],
    proxy: {
      // Proxy API and tRPC requests to the backend server
      // This makes all requests appear to come from the same origin, fixing cookie issues
      '/api': {
        target: serverUrl,
        changeOrigin: true,
        cookieDomainRewrite: '', // Remove domain from cookies so they work with proxy
        cookiePathRewrite: '/', // Ensure cookies work for all paths
      },
      '/trpc': {
        target: serverUrl,
        changeOrigin: true,
        cookieDomainRewrite: '', // Remove domain from cookies so they work with proxy
        cookiePathRewrite: '/', // Ensure cookies work for all paths
      },
    },
  },
});
