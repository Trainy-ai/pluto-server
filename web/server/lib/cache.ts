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

/**
 * L1 In-memory LRU cache (per-pod).
 *
 * IMPORTANT — memory safety: we cap BOTH entry count AND total bytes.
 * Chart responses can be multi-MB each; without maxSize the cache can
 * grow to many GB long before the 10k entry cap kicks in, blowing a
 * 1GB pod heap after only a few hundred distinct-key requests.
 *
 * maxSize enforces LRU eviction on byte budget. The sizeCalculation
 * runs only on set() (not on get()) so it's amortized over the cache-fill
 * cost, and JSON.stringify on a freshly-fetched response is cheap relative
 * to the ClickHouse query it's caching.
 *
 * The *2 multiplier approximates V8's UTF-16 string representation
 * (each JSON byte becomes 2 bytes in heap) plus rough object overhead.
 */
// Sized for a 2 GiB pod memory limit with ~30% safety margin on peak RSS.
// Empirical fit from local load testing: peak RSS ≈ 200 MB baseline + 1.8 × maxSize.
// For a 2048 MB limit: (2048 × 0.85 − 200) / 1.8 ≈ 857 MB theoretical max.
// We pick 384 MB to leave plenty of headroom for GC pauses, Prisma, and burst
// traffic heavier than the load test covered.
const L1_MAX_BYTES = 384 * 1024 * 1024; // 384 MB

const l1Cache = new LRUCache<string, CacheEntry<unknown>>({
  max: 10000, // Entry count cap (backstop)
  maxSize: L1_MAX_BYTES, // Byte budget — primary memory safeguard
  sizeCalculation: (value) => {
    // Fast path: pre-serialized strings (routes/chart-data.ts ":raw" entries)
    // skip a redundant multi-MB stringify + escape pass on every set().
    if (typeof value.data === "string") {
      return value.data.length * 2 + 128;
    }
    try {
      return JSON.stringify(value).length * 2;
    } catch {
      // Non-serializable fallback: small enough not to dominate, big enough
      // that many of them will still trigger eviction.
      return 1024;
    }
  },
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
 * Per-request memoized lookup of run statuses. When multiple withBatchCache
 * calls fire within the same tRPC HTTP batch, they all want the same status
 * answer for the same runIds. Without memoization each call independently
 * fires a Prisma findMany — N batched procedures = N identical PG round trips.
 *
 * The cache lives on `ctx.runStatusCache` (created in createContext, scoped
 * to one HTTP request). We store *promises* keyed by runId so concurrent
 * callers see the in-flight query instead of racing to fire their own.
 */
async function getRunStatusesCached(
  ctx: { prisma: PrismaClient; runStatusCache?: Map<bigint, Promise<string>> },
  runIds: number[],
): Promise<string[]> {
  if (runIds.length === 0) return [];

  // Dedupe before cache lookup / Prisma query — defends against callers that
  // pass duplicates and avoids redundant cache.set() overwrites.
  const uniqueRunIds = [...new Set(runIds)];

  const cache = ctx.runStatusCache;
  if (!cache) {
    // Fallback: no cache available (e.g. ctx from non-tRPC code path).
    const runs = await ctx.prisma.runs.findMany({
      where: { id: { in: uniqueRunIds } },
      select: { status: true },
    });
    return runs.map((r: { status: string }) => r.status);
  }

  // Find runIds not yet in the cache; fire ONE Prisma query for the missing
  // set and store a per-id promise synchronously so concurrent callers in the
  // same batch see the in-flight lookup instead of starting their own.
  const missing = uniqueRunIds.filter((id) => !cache.has(BigInt(id)));
  if (missing.length > 0) {
    const fetchPromise = ctx.prisma.runs.findMany({
      where: { id: { in: missing } },
      select: { id: true, status: true },
    });
    for (const id of missing) {
      const bigIntId = BigInt(id);
      cache.set(
        bigIntId,
        fetchPromise.then((rows) => {
          const found = (rows as { id: bigint; status: string }[]).find(
            (r) => r.id === bigIntId,
          );
          return found?.status ?? "RUNNING";
        }),
      );
    }
  }

  return Promise.all(runIds.map((id) => cache.get(BigInt(id)) as Promise<string>));
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
  ctx: { prisma: PrismaClient; runStatusCache?: Map<bigint, Promise<string>> },
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

  // Get worst-case status across all runs for TTL.
  // Uses request-scoped memoization so multiple withBatchCache calls within
  // the same tRPC HTTP batch share one PG lookup instead of firing N copies.
  let ttlMs: number;
  if (params.runIds.length === 0) {
    ttlMs = CACHE_TTL.RUNNING;
  } else {
    const statuses = await getRunStatusesCached(ctx, params.runIds);
    ttlMs = Math.min(
      ...statuses.map((s: string) => getTTLForStatus(s as RunStatus)),
    );
  }

  if (options?.maxTtlMs) {
    ttlMs = Math.min(ttlMs, options.maxTtlMs);
  }

  const result = await queryFn();
  await setCached(cacheKey, result, ttlMs);
  return result;
}
