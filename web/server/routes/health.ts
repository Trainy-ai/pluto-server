import { Hono } from "hono";
import { prisma } from "../lib/prisma";
import { clickhouse } from "../lib/clickhouse";

const router = new Hono();

// Liveness probe - always returns OK if the process is alive
router.get("/health", (c) => {
  return c.text("OK");
});

interface CheckResult {
  status: "up" | "down";
  latency_ms: number;
  error?: string;
}

// Readiness probe - verifies database connectivity
router.get("/health/ready", async (c) => {
  // Run checks in parallel
  const [pgResult, chResult] = await Promise.all([
    (async (): Promise<CheckResult> => {
      const start = Date.now();
      try {
        await prisma.$queryRawUnsafe("SELECT 1");
        return { status: "up", latency_ms: Date.now() - start };
      } catch {
        return {
          status: "down",
          latency_ms: Date.now() - start,
          error: "PostgreSQL health check failed",
        };
      }
    })(),
    (async (): Promise<CheckResult> => {
      const start = Date.now();
      try {
        await clickhouse.query("SELECT 1", undefined);
        return { status: "up", latency_ms: Date.now() - start };
      } catch {
        return {
          status: "down",
          latency_ms: Date.now() - start,
          error: "ClickHouse health check failed",
        };
      }
    })(),
  ]);

  const checks: Record<string, CheckResult> = {
    postgres: pgResult,
    clickhouse: chResult,
  };

  const allHealthy = Object.values(checks).every((ch) => ch.status === "up");

  return c.json(
    { status: allHealthy ? "healthy" : "unhealthy", checks },
    allHealthy ? 200 : 503
  );
});

export default router;
