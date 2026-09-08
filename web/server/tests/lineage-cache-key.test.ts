import { describe, it, expect, vi } from 'vitest';

// lineage-helpers → lib/queries → clickhouse/s3 → env validation, and
// lib/cache → lib/redis. Mock both boundaries so importing the units under
// test doesn't require a configured environment (same approach as
// cache.test.ts).
vi.mock('../lib/queries', () => ({
  queryRunMetricsBucketedByLogName: vi.fn(),
}));
vi.mock('../lib/redis', () => ({
  getRedisClient: vi.fn().mockResolvedValue(null),
  isRedisAvailable: vi.fn().mockReturnValue(false),
}));

import { getLineageFingerprint } from '../trpc/routers/runs/routers/data/procs/lineage-helpers';
import { buildBatchCacheKey } from '../lib/cache';

/**
 * Regression: runs.merge/runs.unmerge mutate forkedFromRunId/forkStep after
 * chart results may already be cached. Cached chart procedures key on the
 * lineage fingerprint so a merge/unmerge is an immediate cache miss instead
 * of serving the stale pre-merge shape until the TTL lapses.
 */

interface LineageRow {
  id: bigint;
  forkedFromRunId: bigint | null;
  forkStep: bigint | null;
}

function prismaWith(rows: LineageRow[]) {
  const byId = new Map(rows.map((r) => [r.id, r]));
  return {
    runs: {
      findMany: async ({ where }: { where: { id: { in: bigint[] } } }) =>
        where.id.in.map((id) => byId.get(id)).filter(Boolean),
    },
  };
}

describe('getLineageFingerprint', () => {
  it('changes when a merge sets forkedFromRunId/forkStep, all other inputs identical', async () => {
    const before = await getLineageFingerprint(
      prismaWith([
        { id: 1n, forkedFromRunId: null, forkStep: null },
        { id: 2n, forkedFromRunId: null, forkStep: null },
      ]),
      [1, 2],
      'org-1',
    );
    const after = await getLineageFingerprint(
      prismaWith([
        { id: 1n, forkedFromRunId: null, forkStep: null },
        { id: 2n, forkedFromRunId: 1n, forkStep: 99n },
      ]),
      [1, 2],
      'org-1',
    );
    expect(before).not.toEqual(after);
    expect(after).toContain('2>1@99');
    // Unmerge restores the exact pre-merge fingerprint (and thus cache key)
    expect(before).toEqual(['1>@', '2>@']);
  });

  it('is deterministic regardless of requested-run order', async () => {
    const rows: LineageRow[] = [
      { id: 1n, forkedFromRunId: null, forkStep: null },
      { id: 2n, forkedFromRunId: 1n, forkStep: 99n },
    ];
    const a = await getLineageFingerprint(prismaWith(rows), [1, 2], 'org-1');
    const b = await getLineageFingerprint(prismaWith(rows), [2, 1], 'org-1');
    expect(a).toEqual(b);
  });

  it('covers the transitive ancestor closure, so an unlink higher up the chain changes the key', async () => {
    // Chain A(1) → B(2) → C(3); only C is requested (its chart stitches all three).
    const merged = await getLineageFingerprint(
      prismaWith([
        { id: 1n, forkedFromRunId: null, forkStep: null },
        { id: 2n, forkedFromRunId: 1n, forkStep: 99n },
        { id: 3n, forkedFromRunId: 2n, forkStep: 249n },
      ]),
      [3],
      'org-1',
    );
    // Unlink B from A: C's own row is untouched, but its stitched output changes.
    const split = await getLineageFingerprint(
      prismaWith([
        { id: 1n, forkedFromRunId: null, forkStep: null },
        { id: 2n, forkedFromRunId: null, forkStep: null },
        { id: 3n, forkedFromRunId: 2n, forkStep: 249n },
      ]),
      [3],
      'org-1',
    );
    expect(merged).toEqual(['1>@', '2>1@99', '3>2@249']);
    expect(split).toEqual(['2>@', '3>2@249']);
    expect(merged).not.toEqual(split);
  });

  it('terminates on a pre-existing lineage cycle instead of looping', async () => {
    const cyclic = await getLineageFingerprint(
      prismaWith([
        { id: 1n, forkedFromRunId: 2n, forkStep: 10n },
        { id: 2n, forkedFromRunId: 1n, forkStep: 20n },
      ]),
      [1],
      'org-1',
    );
    expect(cyclic).toEqual(['1>2@10', '2>1@20']);
  });
});

describe('chart cache key with lineage fingerprint', () => {
  const base = {
    runIds: [1, 2],
    organizationId: 'org-1',
    projectName: 'proj',
    logNames: ['train/loss'],
    buckets: 1000,
  };

  it('produces a different key after merge while every other param is identical', async () => {
    const keyBefore = buildBatchCacheKey('graphMultiMetricBatchBucketedLineage', {
      ...base,
      lineage: await getLineageFingerprint(
        prismaWith([
          { id: 1n, forkedFromRunId: null, forkStep: null },
          { id: 2n, forkedFromRunId: null, forkStep: null },
        ]),
        [1, 2],
        'org-1',
      ),
    });
    const keyAfter = buildBatchCacheKey('graphMultiMetricBatchBucketedLineage', {
      ...base,
      lineage: await getLineageFingerprint(
        prismaWith([
          { id: 1n, forkedFromRunId: null, forkStep: null },
          { id: 2n, forkedFromRunId: 1n, forkStep: 99n },
        ]),
        [1, 2],
        'org-1',
      ),
    });
    expect(keyBefore).not.toBe(keyAfter);
  });

  it('omitting the fingerprint (fast zoom/preview path) leaves the legacy key shape unchanged', () => {
    const legacy = buildBatchCacheKey('graphMultiMetricBatchBucketed', base);
    const withUndefined = buildBatchCacheKey('graphMultiMetricBatchBucketed', {
      ...base,
      lineage: undefined,
    });
    expect(withUndefined).toBe(legacy);
  });
});
