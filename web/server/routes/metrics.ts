import { Hono } from "hono";
import v8 from "v8";

const router = new Hono();

/**
 * Prometheus-format metrics endpoint for runtime heap/memory telemetry.
 *
 * Served on a dedicated internal-only port (8080 by default, see
 * instrumentation.ts). NOT mounted on the main app port (3001) because:
 *   - Public ingress (ALB / Apoxy) only forwards the Service's named
 *     http port. The metrics port isn't exposed externally, so the
 *     endpoint is internal-only by infrastructure — no auth middleware
 *     or path-filtering needed.
 *   - Matches convention: kube-state-metrics on 8080, node-exporter on
 *     9100, etc. Every Prometheus exporter in the ecosystem uses a
 *     dedicated port.
 *
 * Runs in the same Node process as the main app (spawned from
 * instrumentation.ts), so process.memoryUsage() and
 * v8.getHeapStatistics() reflect the actual app's heap — the entire
 * point of this telemetry.
 *
 * Per-pod label via HOSTNAME so replicas are distinguishable (each
 * replica has its own V8 heap — alerts must be per-pod, not summed
 * across the deployment).
 */
router.get("/metrics", (c) => {
  const mu = process.memoryUsage();
  const h = v8.getHeapStatistics();
  const pod = process.env.HOSTNAME || "unknown";
  const labels = `{pod="${pod}"}`;

  const lines = [
    `# HELP pluto_backend_heap_used_bytes V8 heap currently in use`,
    `# TYPE pluto_backend_heap_used_bytes gauge`,
    `pluto_backend_heap_used_bytes${labels} ${mu.heapUsed}`,

    `# HELP pluto_backend_heap_total_bytes V8 heap currently allocated (committed)`,
    `# TYPE pluto_backend_heap_total_bytes gauge`,
    `pluto_backend_heap_total_bytes${labels} ${mu.heapTotal}`,

    `# HELP pluto_backend_heap_size_limit_bytes V8 hard heap ceiling (--max-old-space-size or default ~1.5 GB)`,
    `# TYPE pluto_backend_heap_size_limit_bytes gauge`,
    `pluto_backend_heap_size_limit_bytes${labels} ${h.heap_size_limit}`,

    `# HELP pluto_backend_rss_bytes Resident Set Size — total process memory from OS perspective`,
    `# TYPE pluto_backend_rss_bytes gauge`,
    `pluto_backend_rss_bytes${labels} ${mu.rss}`,

    `# HELP pluto_backend_external_bytes Memory used by C++ objects bound to JS (Buffers, native)`,
    `# TYPE pluto_backend_external_bytes gauge`,
    `pluto_backend_external_bytes${labels} ${mu.external}`,

    `# HELP pluto_backend_array_buffers_bytes Memory allocated for ArrayBuffers and SharedArrayBuffers (subset of external)`,
    `# TYPE pluto_backend_array_buffers_bytes gauge`,
    `pluto_backend_array_buffers_bytes${labels} ${mu.arrayBuffers}`,

    `# HELP pluto_backend_heap_mallocated_memory_bytes V8 heap malloced memory`,
    `# TYPE pluto_backend_heap_mallocated_memory_bytes gauge`,
    `pluto_backend_heap_mallocated_memory_bytes${labels} ${h.malloced_memory}`,

    `# HELP pluto_backend_heap_used_ratio V8 heap used as fraction of heap_size_limit (0.0 – 1.0)`,
    `# TYPE pluto_backend_heap_used_ratio gauge`,
    `pluto_backend_heap_used_ratio${labels} ${mu.heapUsed / h.heap_size_limit}`,

    `# HELP pluto_backend_process_uptime_seconds Seconds since the Node process started`,
    `# TYPE pluto_backend_process_uptime_seconds counter`,
    `pluto_backend_process_uptime_seconds${labels} ${process.uptime()}`,
    "",
  ].join("\n");

  return c.text(lines, 200, {
    "content-type": "text/plain; version=0.0.4; charset=utf-8",
  });
});

export default router;
