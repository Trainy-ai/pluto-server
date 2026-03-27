import { LRUCache } from "lru-cache";
import { getRedisClient, isRedisAvailable } from "./redis";
import type { PrismaClient } from "@prisma/client";

/**
 * Two-tier cache service for graph data and other ClickHouse queries.
 *
 * L1: In-memory LRU cache (per-pod, ~0ms latency)
 * L2: Redis (shared across pods, ~1-2ms latency)
 *
 * Features:
 * - Graceful degradation if Redis unavailable (L1 only)
 * - Status-aware TTL (short for running runs, long for completed)
 * - Cache key generation helpers
 * - withCache wrapper for easy procedure caching
 */

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

// L1 In-memory LRU cache (per-pod)
const l1Cache = new LRUCache<string, CacheEntry<unknown>>({
  max: 10000, // Max 10k entries
  ttl: 1000 * 60 * 10, // 10 min max TTL (entries also check expiresAt)
  updateAgeOnGet: true,
});

/**
 * TTL constants based on run status.
 * Running runs need fresh data (short TTL).
 * Completed runs are static (long TTL).
 */
export const CACHE_TTL = {
  RUNNING: 30 * 1000, // 30 seconds for running runs
  COMPLETED: 5 * 60 * 1000, // 5 minutes for completed runs
  FAILED: 5 * 60 * 1000,
  TERMINATED: 5 * 60 * 1000,
  CANCELLED: 5 * 60 * 1000,
} as const;

export type RunStatus = keyof typeof CACHE_TTL;

/**
 * Get TTL for a given run status.
 */
export function getTTLForStatus(status: RunStatus | string): number {
  return CACHE_TTL[status as RunStatus] || CACHE_TTL.RUNNING;
}

/**
 * Get cached value from L1 (memory) then L2 (Redis).
 * Returns null on cache miss.
 */
export async function getCached<T>(key: string): Promise<T | null> {
  // Try L1 first (instant)
  const l1Entry = l1Cache.get(key) as CacheEntry<T> | undefined;
  if (l1Entry && l1Entry.expiresAt > Date.now()) {
    return l1Entry.data;
  }

  // Try L2 (Redis)
  const redis = await getRedisClient();
  if (redis) {
    try {
      const redisValue = await redis.get(key);
      if (redisValue) {
        const entry = JSON.parse(redisValue) as CacheEntry<T>;
        if (entry.expiresAt > Date.now()) {
          // Backfill L1 cache for next request
          l1Cache.set(key, entry);
          return entry.data;
        }
      }
    } catch (err: unknown) {
      console.warn("[Cache] Redis get failed:", err);
    }
  }

  return null;
}

/**
 * Set cached value in both L1 (memory) and L2 (Redis).
 */
export async function setCached<T>(
  key: string,
  data: T,
  ttlMs: number
): Promise<void> {
  const entry: CacheEntry<T> = {
    data,
    expiresAt: Date.now() + ttlMs,
  };

  // Set L1 (synchronous)
  l1Cache.set(key, entry, { ttl: ttlMs });

  // Set L2 (Redis) - fire and forget, don't block
  const redis = await getRedisClient();
  if (redis) {
    redis
      .setEx(key, Math.ceil(ttlMs / 1000), JSON.stringify(entry))
      .catch((err: unknown) => {
        console.warn("[Cache] Redis set failed:", err);
      });
  }
}

/**
 * Build a deterministic cache key from procedure name and parameters.
 * Parameters are sorted to ensure consistent keys regardless of object key order.
 */
export function buildCacheKey(
  procedure: string,
  params: Record<string, string | number | undefined>
): string {
  const sortedParams = Object.keys(params)
    .filter((k) => params[k] !== undefined)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join(":");
  return `mlop:${procedure}:${sortedParams}`;
}

/**
 * Clear L1 cache (useful for testing).
 */
export function clearL1Cache(): void {
  l1Cache.clear();
}

/**
 * Build a deterministic cache key that supports array-valued params
 * (e.g., runIds, logNames). Arrays are sorted for order-independence.
 */
export function buildBatchCacheKey(
  procedure: string,
  params: Record<string, string | number | boolean | string[] | number[] | undefined>
): string {
  const parts: string[] = [];
  for (const k of Object.keys(params).sort()) {
    const v = params[k];
    if (v === undefined) continue;
    if (Array.isArray(v)) {
      parts.push(`${k}=${[...v].sort().join(",")}`);
    } else {
      parts.push(`${k}=${v}`);
    }
  }
  return `mlop:${procedure}:${parts.join(":")}`;
}

/**
 * Cache options for withCache wrapper.
 */
interface WithCacheOptions {
  /** Maximum TTL in ms, caps status-based TTL (e.g., for S3 presigned URLs) */
  maxTtlMs?: number;
}

/**
 * Cache parameters required for building cache keys and determining TTL.
 */
interface CacheParams {
  runId: number;
  organizationId: string;
  projectName: string;
  [key: string]: string | number | undefined;
}

/**
 * Cache parameters for batch endpoints that operate on multiple runs.
 */
interface BatchCacheParams {
  runIds: number[];
  organizationId: string;
  projectName: string;
  [key: string]: string | number | boolean | string[] | number[] | undefined;
}

/**
 * Wrapper that handles caching for ClickHouse procedures.
 *
 * Consolidates caching logic:
 * - Builds cache key from procedure name + params
 * - Checks L1/L2 cache
 * - Fetches run status for TTL determination
 * - Caches result with status-aware TTL
 *
 * @example
 * ```ts
 * return withCache(ctx, "graph", { runId, organizationId, projectName, logName }, async () => {
 *   const result = await clickhouse.query(...);
 *   return result.json();
 * });
 * ```
 */
export async function withCache<T>(
  ctx: { prisma: PrismaClient },
  procedure: string,
  params: CacheParams,
  queryFn: () => Promise<T>,
  options?: WithCacheOptions
): Promise<T> {
  // Build cache key from params
  const cacheKey = buildCacheKey(procedure, {
    orgId: params.organizationId,
    projectName: params.projectName,
    runId: params.runId.toString(),
    ...Object.fromEntries(
      Object.entries(params).filter(
        ([k]) => !["runId", "organizationId", "projectName"].includes(k)
      )
    ),
  });

  // Try cache first
  const cached = await getCached<T>(cacheKey);
  if (cached) {
    return cached;
  }

  // Get run status for TTL determination
  const run = await ctx.prisma.runs.findUnique({
    where: { id: params.runId },
    select: { status: true },
  });
  const status: RunStatus = (run?.status as RunStatus) || "RUNNING";
  let ttlMs = getTTLForStatus(status);

  // Cap TTL if maxTtlMs specified (e.g., for S3 presigned URLs)
  if (options?.maxTtlMs) {
    ttlMs = Math.min(ttlMs, options.maxTtlMs);
  }

  // Execute the query
  const result = await queryFn();

  // Cache the result
  await setCached(cacheKey, result, ttlMs);

  return result;
}

/**
 * Cache wrapper for batch endpoints that operate on multiple runs
 * (e.g., graphBatchBucketed, graphMultiMetricBatchBucketed).
 *
 * Uses worst-case (shortest) TTL across all runs — if any run is RUNNING,
 * the entry gets a 5s TTL; if all are COMPLETED, it gets 5 minutes.
 */
export async function withBatchCache<T>(
  ctx: { prisma: PrismaClient },
  procedure: string,
  params: BatchCacheParams,
  queryFn: () => Promise<T>,
  options?: WithCacheOptions
): Promise<T> {
  const cacheKey = buildBatchCacheKey(procedure, {
    orgId: params.organizationId,
    projectName: params.projectName,
    ...Object.fromEntries(
      Object.entries(params).filter(
        ([k]) => !["organizationId", "projectName"].includes(k)
      )
    ),
  });

  // Try cache first
  const cached = await getCached<T>(cacheKey);
  if (cached) {
    return cached;
  }

  // Get worst-case status across all runs for TTL
  const runs = await ctx.prisma.runs.findMany({
    where: { id: { in: params.runIds } },
    select: { status: true },
  });

  let ttlMs: number;
  if (runs.length === 0) {
    ttlMs = CACHE_TTL.RUNNING;
  } else {
    ttlMs = Math.min(...runs.map((r: { status: string }) => getTTLForStatus(r.status as RunStatus)));
  }

  if (options?.maxTtlMs) {
    ttlMs = Math.min(ttlMs, options.maxTtlMs);
  }

  const result = await queryFn();
  await setCached(cacheKey, result, ttlMs);
  return result;
}
