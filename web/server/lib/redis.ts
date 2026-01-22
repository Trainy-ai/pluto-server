import { createClient, type RedisClientType } from "redis";
import { env } from "./env";

let client: RedisClientType | null = null;
let isConnected = false;
let connectionAttempted = false;

/**
 * Get Redis client with graceful degradation.
 * Returns null if Redis is not configured or connection fails.
 * This allows the application to work without Redis (L1 cache only).
 */
export async function getRedisClient(): Promise<RedisClientType | null> {
  // No Redis URL configured - graceful degradation
  if (!env.REDIS_URL) {
    return null;
  }

  // Already attempted connection and failed - don't retry
  if (connectionAttempted && !isConnected) {
    return null;
  }

  // Already connected - return existing client
  if (client && isConnected) {
    return client;
  }

  connectionAttempted = true;

  try {
    client = createClient({
      url: env.REDIS_URL,
      socket: {
        connectTimeout: 2000, // Fast fail - 2 seconds
        reconnectStrategy: (retries: number) => {
          if (retries > 3) {
            console.warn("[Redis] Max reconnection attempts reached, disabling Redis");
            isConnected = false;
            return false; // Stop retrying
          }
          return Math.min(retries * 100, 1000);
        },
      },
    });

    client.on("error", (err: Error) => {
      console.warn("[Redis] Connection error, degrading gracefully:", err.message);
      isConnected = false;
    });

    client.on("connect", () => {
      console.log("[Redis] Connected successfully");
      isConnected = true;
    });

    client.on("reconnecting", () => {
      console.log("[Redis] Attempting to reconnect...");
    });

    await client.connect();
    return client;
  } catch (err) {
    console.warn("[Redis] Failed to connect, using L1 cache only:", err);
    isConnected = false;
    return null;
  }
}

/**
 * Check if Redis is currently available.
 */
export function isRedisAvailable(): boolean {
  return isConnected;
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

  const client = await getRedisClient();

  if (client && isConnected) {
    console.log("[Cache] Two-tier caching enabled: L1 (in-memory) + L2 (Redis)");
  } else {
    console.log("[Cache] Redis connection failed - falling back to L1 (in-memory) cache only");
  }
}

/**
 * Gracefully disconnect Redis client.
 * Call this during server shutdown.
 */
export async function disconnectRedis(): Promise<void> {
  if (client && isConnected) {
    try {
      await client.quit();
      console.log("[Redis] Disconnected gracefully");
    } catch (err) {
      console.warn("[Redis] Error during disconnect:", err);
    } finally {
      isConnected = false;
      client = null;
    }
  }
}
