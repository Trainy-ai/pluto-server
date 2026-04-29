/**
 * Cache Unit Tests
 *
 * Tests for the two-tier caching system (L1 in-memory + L2 Redis).
 * Run with: pnpm test:cache
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  getCached,
  setCached,
  buildCacheKey,
  getTTLForStatus,
  clearL1Cache,
  withCache,
  CACHE_TTL,
} from '../lib/cache';

// Mock Redis client
vi.mock('../lib/redis', () => ({
  getRedisClient: vi.fn().mockResolvedValue(null), // Default: no Redis
  isRedisAvailable: vi.fn().mockReturnValue(false),
}));

// Fake Redis backed by an in-memory Map. Mirrors the subset of the redis client
// API that cache.ts uses (get / setEx). Lets us exercise the L2 round-trip path.
function createFakeRedis() {
  const store = new Map<string, string>();
  return {
    store,
    client: {
      get: async (key: string) => store.get(key) ?? null,
      setEx: async (key: string, _ttlSeconds: number, value: string) => {
        store.set(key, value);
        return 'OK';
      },
    },
  };
}

async function withFakeRedis<T>(fn: (store: Map<string, string>) => Promise<T>): Promise<T> {
  const { getRedisClient } = await import('../lib/redis');
  const fake = createFakeRedis();
  vi.mocked(getRedisClient).mockResolvedValue(fake.client as never);
  try {
    return await fn(fake.store);
  } finally {
    vi.mocked(getRedisClient).mockResolvedValue(null);
  }
}

describe('Cache Unit Tests', () => {
  beforeEach(() => {
    // Clear L1 cache before each test
    clearL1Cache();
  });

  describe('buildCacheKey', () => {
    it('creates deterministic keys from params', () => {
      const key1 = buildCacheKey('graph', {
        orgId: 'org-1',
        projectName: 'project-1',
        runId: '123',
      });
      const key2 = buildCacheKey('graph', {
        runId: '123',
        orgId: 'org-1',
        projectName: 'project-1',
      });

      // Same params in different order should produce same key
      expect(key1).toBe(key2);
      expect(key1).toContain('mlop:graph:');
    });

    it('filters undefined params', () => {
      const key = buildCacheKey('logs', {
        orgId: 'org-1',
        projectName: 'project-1',
        runId: '123',
        logName: undefined,
      });

      expect(key).not.toContain('logName');
    });

    it('creates unique keys for different params', () => {
      const key1 = buildCacheKey('graph', { runId: '123', orgId: 'org-1', projectName: 'p1' });
      const key2 = buildCacheKey('graph', { runId: '456', orgId: 'org-1', projectName: 'p1' });

      expect(key1).not.toBe(key2);
    });

    it('creates unique keys for different procedures', () => {
      const params = { runId: '123', orgId: 'org-1', projectName: 'p1' };
      const key1 = buildCacheKey('graph', params);
      const key2 = buildCacheKey('logs', params);

      expect(key1).not.toBe(key2);
    });
  });

  describe('getTTLForStatus', () => {
    it('returns short TTL for RUNNING status', () => {
      expect(getTTLForStatus('RUNNING')).toBe(CACHE_TTL.RUNNING);
      expect(getTTLForStatus('RUNNING')).toBe(30000); // 30 seconds
    });

    it('returns long TTL for completed statuses', () => {
      expect(getTTLForStatus('COMPLETED')).toBe(CACHE_TTL.COMPLETED);
      expect(getTTLForStatus('FAILED')).toBe(CACHE_TTL.FAILED);
      expect(getTTLForStatus('TERMINATED')).toBe(CACHE_TTL.TERMINATED);
      expect(getTTLForStatus('CANCELLED')).toBe(CACHE_TTL.CANCELLED);

      // All should be 5 minutes
      expect(getTTLForStatus('COMPLETED')).toBe(5 * 60 * 1000);
    });

    it('defaults to RUNNING TTL for unknown status', () => {
      expect(getTTLForStatus('UNKNOWN_STATUS')).toBe(CACHE_TTL.RUNNING);
    });
  });

  describe('L1 Cache (in-memory)', () => {
    it('returns null for cache miss', async () => {
      const result = await getCached<string>('nonexistent-key');
      expect(result).toBeNull();
    });

    it('caches and retrieves data', async () => {
      const testData = { value: 42, name: 'test' };
      const key = 'test-key-1';

      await setCached(key, testData, 60000);
      const result = await getCached<typeof testData>(key);

      expect(result).toEqual(testData);
    });

    it('returns null for expired entries', async () => {
      const key = 'test-key-expired';
      await setCached(key, { data: 'test' }, 1); // 1ms TTL

      // Wait for expiration
      await new Promise((resolve) => setTimeout(resolve, 10));

      const result = await getCached<{ data: string }>(key);
      expect(result).toBeNull();
    });

    it('handles different data types', async () => {
      // Array
      await setCached('array-key', [1, 2, 3], 60000);
      expect(await getCached<number[]>('array-key')).toEqual([1, 2, 3]);

      // Nested object
      const nested = { a: { b: { c: 'deep' } } };
      await setCached('nested-key', nested, 60000);
      expect(await getCached<typeof nested>('nested-key')).toEqual(nested);

      // String
      await setCached('string-key', 'hello', 60000);
      expect(await getCached<string>('string-key')).toBe('hello');
    });
  });

  describe('withCache wrapper', () => {
    it('returns cached data on cache hit', async () => {
      // withCache builds key with orgId (not organizationId) and runId as string
      const key = buildCacheKey('test-proc', {
        orgId: 'org-1',
        projectName: 'proj-1',
        runId: '123',
      });

      // Pre-populate cache
      const cachedData = { result: 'cached' };
      await setCached(key, cachedData, 60000);

      // Mock context
      const mockCtx = {
        prisma: {
          runs: {
            findUnique: vi.fn(),
          },
        },
      };

      const queryFn = vi.fn().mockResolvedValue({ result: 'fresh' });

      const result = await withCache(
        mockCtx as any,
        'test-proc',
        { runId: 123, organizationId: 'org-1', projectName: 'proj-1' },
        queryFn
      );

      // Should return cached data
      expect(result).toEqual(cachedData);
      // Query function should NOT be called
      expect(queryFn).not.toHaveBeenCalled();
      // Prisma should NOT be called (no need to fetch status)
      expect(mockCtx.prisma.runs.findUnique).not.toHaveBeenCalled();
    });

    it('executes query and caches result on cache miss', async () => {
      const mockCtx = {
        prisma: {
          runs: {
            findUnique: vi.fn().mockResolvedValue({ status: 'COMPLETED' }),
          },
        },
      };

      const freshData = { result: 'fresh-data' };
      const queryFn = vi.fn().mockResolvedValue(freshData);

      const result = await withCache(
        mockCtx as any,
        'test-proc-miss',
        { runId: 999, organizationId: 'org-2', projectName: 'proj-2' },
        queryFn
      );

      // Should return fresh data
      expect(result).toEqual(freshData);
      // Query function should be called
      expect(queryFn).toHaveBeenCalledTimes(1);
      // Should fetch run status for TTL
      expect(mockCtx.prisma.runs.findUnique).toHaveBeenCalledWith({
        where: { id: 999 },
        select: { status: true },
      });

      // Data should now be cached - use same key format as withCache
      const key = buildCacheKey('test-proc-miss', {
        orgId: 'org-2',
        projectName: 'proj-2',
        runId: '999',
      });
      const cached = await getCached<typeof freshData>(key);
      expect(cached).toEqual(freshData);
    });

    it('uses RUNNING TTL when run not found', async () => {
      const mockCtx = {
        prisma: {
          runs: {
            findUnique: vi.fn().mockResolvedValue(null), // Run not found
          },
        },
      };

      const queryFn = vi.fn().mockResolvedValue({ data: 'test' });

      await withCache(
        mockCtx as any,
        'test-proc-no-run',
        { runId: 888, organizationId: 'org-3', projectName: 'proj-3' },
        queryFn
      );

      // Should still work and use RUNNING TTL (short, safe default)
      expect(queryFn).toHaveBeenCalled();
    });

    it('respects maxTtlMs option', async () => {
      const mockCtx = {
        prisma: {
          runs: {
            findUnique: vi.fn().mockResolvedValue({ status: 'COMPLETED' }), // Would give 5min TTL
          },
        },
      };

      const queryFn = vi.fn().mockResolvedValue({ files: [] });

      // Use maxTtlMs of 1 second (much less than COMPLETED's 5 minutes)
      await withCache(
        mockCtx as any,
        'test-proc-max-ttl',
        { runId: 777, organizationId: 'org-4', projectName: 'proj-4' },
        queryFn,
        { maxTtlMs: 1000 }
      );

      // Verify data was cached - use same key format as withCache
      const key = buildCacheKey('test-proc-max-ttl', {
        orgId: 'org-4',
        projectName: 'proj-4',
        runId: '777',
      });
      const cached = await getCached<{ files: [] }>(key);
      expect(cached).toEqual({ files: [] });

      // Wait for maxTtlMs to expire (but less than COMPLETED TTL)
      await new Promise((resolve) => setTimeout(resolve, 1100));

      // Should be expired now
      const expiredResult = await getCached<{ files: [] }>(key);
      expect(expiredResult).toBeNull();
    });

    it('includes additional params in cache key', async () => {
      const mockCtx = {
        prisma: {
          runs: {
            findUnique: vi.fn().mockResolvedValue({ status: 'COMPLETED' }),
          },
        },
      };

      const queryFn1 = vi.fn().mockResolvedValue({ data: 'log1' });
      const queryFn2 = vi.fn().mockResolvedValue({ data: 'log2' });

      // Call with different logName params
      await withCache(
        mockCtx as any,
        'histogram',
        { runId: 100, organizationId: 'org', projectName: 'proj', logName: 'train/loss' },
        queryFn1
      );

      await withCache(
        mockCtx as any,
        'histogram',
        { runId: 100, organizationId: 'org', projectName: 'proj', logName: 'val/loss' },
        queryFn2
      );

      // Both query functions should be called (different cache keys)
      expect(queryFn1).toHaveBeenCalledTimes(1);
      expect(queryFn2).toHaveBeenCalledTimes(1);
    });
  });

  describe('L2 (Redis) type preservation', () => {
    // Regression coverage for the Pylon #708 root cause: when the L1 entry was
    // evicted (pod restart, LRU pressure, multi-pod hop) the L2 read used
    // JSON.parse, which silently coerced Date fields to ISO strings. The
    // frontend then crashed with "r.getTime is not a function" inside
    // useTimeDetails, which TanStack Router caught via errorComponent and
    // rendered as a misleading "Run not found" page.

    it('round-trips Date through L2 as a Date instance', async () => {
      await withFakeRedis(async () => {
        const original = new Date('2026-04-28T16:33:52.000Z');
        await setCached('l2-date', { time: original }, 60_000);

        // Force the L2 path: clear L1 so the next read has to deserialize from Redis.
        clearL1Cache();

        const result = await getCached<{ time: Date }>('l2-date');
        expect(result).not.toBeNull();
        expect(result!.time).toBeInstanceOf(Date);
        expect(result!.time.getTime()).toBe(original.getTime());
      });
    });

    it('round-trips BigInt through L2 as a bigint', async () => {
      await withFakeRedis(async () => {
        await setCached('l2-bigint', { runId: 9007199254740993n }, 60_000);
        clearL1Cache();

        const result = await getCached<{ runId: bigint }>('l2-bigint');
        expect(result).not.toBeNull();
        expect(typeof result!.runId).toBe('bigint');
        expect(result!.runId).toBe(9007199254740993n);
      });
    });

    it('preserves Date fields inside nested arrays (matches runs.data.logs shape)', async () => {
      await withFakeRedis(async () => {
        const logs = [
          { time: new Date('2026-04-28T16:33:52.000Z'), message: 'a', logType: 'INFO', lineNumber: 1 },
          { time: new Date('2026-04-28T16:33:53.500Z'), message: 'b', logType: 'INFO', lineNumber: 2 },
        ];
        await setCached('l2-logs', logs, 60_000);
        clearL1Cache();

        const result = await getCached<typeof logs>('l2-logs');
        expect(result).not.toBeNull();
        expect(result).toHaveLength(2);
        for (const entry of result!) {
          expect(entry.time).toBeInstanceOf(Date);
        }
        expect(result![0].time.getTime()).toBe(logs[0].time.getTime());
      });
    });

    it('treats malformed L2 entries (legacy raw JSON or corruption) as a miss', async () => {
      await withFakeRedis(async (store) => {
        // Simulate a legacy entry written by the previous JSON.stringify implementation.
        // The new superjson reader should not throw; it should return null so the
        // caller refetches and overwrites with a properly-typed entry.
        store.set(
          'mlop:legacy:k=1',
          JSON.stringify({ data: { time: new Date().toISOString() }, expiresAt: Date.now() + 60_000 })
        );

        const result = await getCached('mlop:legacy:k=1');
        expect(result).toBeNull();
      });
    });
  });

  describe('Cache Performance', () => {
    it('cache hit is faster than cache miss', async () => {
      const mockCtx = {
        prisma: {
          runs: {
            findUnique: vi.fn().mockImplementation(async () => {
              // Simulate DB latency
              await new Promise((resolve) => setTimeout(resolve, 10));
              return { status: 'COMPLETED' };
            }),
          },
        },
      };

      const queryFn = vi.fn().mockImplementation(async () => {
        // Simulate ClickHouse query latency
        await new Promise((resolve) => setTimeout(resolve, 50));
        return { data: 'result' };
      });

      // First call (cache miss)
      const missStart = performance.now();
      await withCache(
        mockCtx as any,
        'perf-test',
        { runId: 555, organizationId: 'org-perf', projectName: 'proj-perf' },
        queryFn
      );
      const missTime = performance.now() - missStart;

      // Second call (cache hit)
      const hitStart = performance.now();
      await withCache(
        mockCtx as any,
        'perf-test',
        { runId: 555, organizationId: 'org-perf', projectName: 'proj-perf' },
        queryFn
      );
      const hitTime = performance.now() - hitStart;

      // Cache hit should be significantly faster
      expect(hitTime).toBeLessThan(missTime * 0.5);
      // Query function should only be called once
      expect(queryFn).toHaveBeenCalledTimes(1);
    });
  });
});
