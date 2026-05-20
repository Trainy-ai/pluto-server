import { createClient, type RedisClientType } from "redis";
import { env } from "./env";

let client: RedisClientType | null = null;
let isReady = false;
let initStarted = false;

/**
 * Exponential backoff for Redis reconnects, capped at 30s, with jitter.
 *
 * Retries forever — Karpenter can evict the Redis pod at any time and we
 * want backend pods to silently reconnect when it comes back, instead of
 * permanently falling through to L1 after a handful of failed attempts.
 *
 * Sequence (approx): 100ms, 200ms, 400ms, 800ms, ..., 30s, 30s, ...
 */
function reconnectStrategy(retries: number): number {
  const base = Math.min(100 * 2 ** retries, 30_000);
  const jitter = Math.floor(Math.random() * 250);
  return base + jitter;
}

function buildClient(): RedisClientType {
  const c: RedisClientType = createClient({
    url: env.REDIS_URL,
    socket: {
      connectTimeout: 5000,
      reconnectStrategy,
    },
  });

  c.on("error", (err: Error) => {
    // node-redis emits an error on every failed reconnect attempt; only log
    // the transition from healthy → unhealthy to avoid flooding logs during
    // a multi-minute Redis outage.
    if (isReady) {
      console.warn("[Redis] Connection lost, will reconnect:", err.message);
    }
    isReady = false;
  });

  c.on("ready", () => {
    console.log("[Redis] Connected and ready");
    isReady = true;
  });

  c.on("end", () => {
    isReady = false;
  });

  return c;
}

/**
 * Get Redis client with graceful degradation.
 * Returns null if Redis is not configured, or if the connection is not
 * currently ready (callers fall back to L1). Reconnection happens in the
 * background indefinitely — a null return is never terminal.
 */
export async function getRedisClient(): Promise<RedisClientType | null> {
  if (!env.REDIS_URL) {
    return null;
  }

  if (!initStarted) {
    initStarted = true;
    client = buildClient();
    // Fire-and-forget initial connect. The built-in reconnectStrategy keeps
    // retrying forever on failure, so we don't block callers and we don't
    // permanently disable Redis if it happens to be unreachable at boot.
    client.connect().catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn("[Redis] Initial connect failed, will keep retrying:", msg);
    });
  }

  return isReady ? client : null;
}

/**
 * Check if Redis is currently available.
 */
export function isRedisAvailable(): boolean {
  return isReady;
}

/**
 * Initialize Redis connection and log status.
 * Call this on server startup to eagerly connect and log cache configuration.
 */
export async function initRedis(): Promise<void> {
  console.log("[Cache] Initializing cache layer...");

  if (!env.REDIS_URL) {
    console.log("[Cache] REDIS_URL not configured - using L1 (in-memory) cache only");
    return;
  }

  console.log("[Cache] REDIS_URL configured - attempting L2 (Redis) connection...");
  await getRedisClient();

  // Wait briefly for the initial connect so the startup log reflects reality
  // in the common case. Aligned with the socket connectTimeout above, plus a
  // small margin for the post-connect handshake, so a slow-but-reachable
  // Redis (cold start, cross-AZ latency) still gets reported as ready.
  // If Redis is down at boot we degrade to L1 here, and the background
  // reconnect upgrades us silently once it comes back.
  const pollMs = 100;
  for (let waited = 0; waited < env.REDIS_READY_WAIT_MS && !isReady; waited += pollMs) {
    await new Promise((r) => setTimeout(r, pollMs));
  }

  if (isReady) {
    console.log("[Cache] Two-tier caching enabled: L1 (in-memory) + L2 (Redis)");
  } else {
    console.log(
      "[Cache] Redis not yet ready - serving L1 only; will upgrade to L2 when reconnect succeeds",
    );
  }
}
