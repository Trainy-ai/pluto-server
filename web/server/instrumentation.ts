/**
 * Next.js Instrumentation
 *
 * This file runs once when the Next.js server starts.
 * Used to initialize services and log startup configuration.
 *
 * @see https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 */

export async function register() {
  // Only run on the server
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { initRedis } = await import("./lib/redis");
    await initRedis();

    // Start a separate HTTP listener on port 8080 for /metrics.
    // Runs in the same Node process as the main app so process.memoryUsage()
    // and v8.getHeapStatistics() reflect the REAL app's heap — which is the
    // entire point of this telemetry.
    //
    // Why a separate port (not /metrics on 3001):
    //   - Public ingress (ALB / Apoxy) only forwards the main Service port.
    //     Port 8080 isn't routed externally, so the endpoint is internal-only
    //     by infrastructure — no token auth or path-filtering needed.
    //   - Matches convention (kube-state-metrics on 8080, node-exporter on
    //     9100, etc.).
    const port = Number(process.env.METRICS_PORT) || 8080;
    const [{ Hono }, { serve }, { default: metricsRoutes }] = await Promise.all([
      import("hono"),
      import("@hono/node-server"),
      import("./routes/metrics"),
    ]);
    const metricsApp = new Hono();
    metricsApp.route("/", metricsRoutes);
    serve({ fetch: metricsApp.fetch, port, hostname: "0.0.0.0" }, (info) => {
      console.log(`[Metrics] /metrics listening on :${info.port} (internal-only)`);
    });
  }
}
