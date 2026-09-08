import { describe, it, expect } from 'vitest';
import {
  planMergeChain,
  getStepBoundsByRunId,
  MergePlanError,
  type MergeCandidate,
  type StepBounds,
} from '../lib/merge-helpers';
import type { clickhouse } from '../lib/clickhouse';

function run(id: number, name: string, createdAt: string, forkedFrom: number | null = null): MergeCandidate {
  return {
    id: BigInt(id),
    name,
    createdAt: new Date(createdAt),
    forkedFromRunId: forkedFrom === null ? null : BigInt(forkedFrom),
  };
}

const NO_ANCESTORS = () => new Set<bigint>();

function bounds(entries: Array<[number, StepBounds]>): Map<bigint, StepBounds> {
  return new Map(entries.map(([id, b]) => [BigInt(id), b]));
}

describe('planMergeChain', () => {
  it('links a crashed run and its restart with forkStep = child minStep - 1', () => {
    const runs = [
      run(2, 'restart', '2026-08-27T11:40:00Z'),
      run(1, 'crashed', '2026-08-27T09:12:00Z'),
    ];
    const b = bounds([
      [1, { minStep: 0, maxStep: 100 }],
      [2, { minStep: 80, maxStep: 180 }],
    ]);
    const plan = planMergeChain(runs, b, NO_ANCESTORS);
    expect(plan.links).toEqual([{ childId: 2n, parentId: 1n, forkStep: 79 }]);
    expect(plan.alreadyLinked).toEqual([]);
  });

  it('orders by createdAt regardless of input order and chains 3 runs', () => {
    const runs = [
      run(3, 'r3', '2026-08-27T15:00:00Z'),
      run(1, 'r1', '2026-08-27T09:00:00Z'),
      run(2, 'r2', '2026-08-27T12:00:00Z'),
    ];
    const b = bounds([
      [1, { minStep: 0, maxStep: 100 }],
      [2, { minStep: 90, maxStep: 200 }],
      [3, { minStep: 190, maxStep: 300 }],
    ]);
    const plan = planMergeChain(runs, b, NO_ANCESTORS);
    expect(plan.links).toEqual([
      { childId: 2n, parentId: 1n, forkStep: 89 },
      { childId: 3n, parentId: 2n, forkStep: 189 },
    ]);
  });

  it('clamps forkStep to parent maxStep when the child starts past the parent end (gap)', () => {
    const runs = [
      run(1, 'a', '2026-08-27T09:00:00Z'),
      run(2, 'b', '2026-08-27T12:00:00Z'),
    ];
    const b = bounds([
      [1, { minStep: 0, maxStep: 50 }],
      [2, { minStep: 200, maxStep: 300 }],
    ]);
    const plan = planMergeChain(runs, b, NO_ANCESTORS);
    expect(plan.links).toEqual([{ childId: 2n, parentId: 1n, forkStep: 50 }]);
  });

  it('skips a pair already linked to the same parent (idempotent)', () => {
    const runs = [
      run(1, 'a', '2026-08-27T09:00:00Z'),
      run(2, 'b', '2026-08-27T12:00:00Z', 1),
    ];
    const b = bounds([
      [1, { minStep: 0, maxStep: 100 }],
      [2, { minStep: 80, maxStep: 180 }],
    ]);
    const plan = planMergeChain(runs, b, NO_ANCESTORS);
    expect(plan.links).toEqual([]);
    expect(plan.alreadyLinked).toEqual([2n]);
  });

  it('throws CONFLICT when the child is linked to a different run', () => {
    const runs = [
      run(1, 'a', '2026-08-27T09:00:00Z'),
      run(2, 'b', '2026-08-27T12:00:00Z', 99),
    ];
    const b = bounds([
      [1, { minStep: 0, maxStep: 100 }],
      [2, { minStep: 80, maxStep: 180 }],
    ]);
    expect(() => planMergeChain(runs, b, NO_ANCESTORS)).toThrowError(MergePlanError);
    try {
      planMergeChain(runs, b, NO_ANCESTORS);
    } catch (e) {
      expect((e as MergePlanError).code).toBe('CONFLICT');
      expect((e as MergePlanError).message).toContain('b');
    }
  });

  it('throws BAD_REQUEST when the child has no metrics', () => {
    const runs = [
      run(1, 'a', '2026-08-27T09:00:00Z'),
      run(2, 'b', '2026-08-27T12:00:00Z'),
    ];
    const b = bounds([[1, { minStep: 0, maxStep: 100 }]]);
    expect(() => planMergeChain(runs, b, NO_ANCESTORS)).toThrowError(/logged/);
  });

  it('throws BAD_REQUEST when the parent has no metrics', () => {
    const runs = [
      run(1, 'a', '2026-08-27T09:00:00Z'),
      run(2, 'b', '2026-08-27T12:00:00Z'),
    ];
    const b = bounds([[2, { minStep: 80, maxStep: 180 }]]);
    expect(() => planMergeChain(runs, b, NO_ANCESTORS)).toThrowError(MergePlanError);
  });

  it('throws BAD_REQUEST when the child starts at step 0', () => {
    const runs = [
      run(1, 'a', '2026-08-27T09:00:00Z'),
      run(2, 'b', '2026-08-27T12:00:00Z'),
    ];
    const b = bounds([
      [1, { minStep: 0, maxStep: 100 }],
      [2, { minStep: 0, maxStep: 180 }],
    ]);
    expect(() => planMergeChain(runs, b, NO_ANCESTORS)).toThrowError(/step 0/);
  });

  it('throws BAD_REQUEST when linking would create a cycle', () => {
    // Run 1 is (pathologically) already a fork of run 2; merging 1←2 would cycle.
    const runs = [
      run(1, 'a', '2026-08-27T09:00:00Z', 2),
      run(2, 'b', '2026-08-27T12:00:00Z'),
    ];
    const b = bounds([
      [1, { minStep: 0, maxStep: 100 }],
      [2, { minStep: 80, maxStep: 180 }],
    ]);
    const ancestors = (id: bigint) => (id === 1n ? new Set([2n]) : new Set<bigint>());
    expect(() => planMergeChain(runs, b, ancestors)).toThrowError(/cycle/i);
  });

  it('computes the boundary from user metrics when sys metrics are excluded (SDK crash/restart)', () => {
    // Regression for the sys/* bug: the SDK auto-logs sys metrics on their own
    // step counter (starting near 1). With those rows excluded, a restart whose
    // user metrics span 100–300 must yield forkStep 99 — not 0, which would
    // truncate the entire parent in the stitched view.
    const runs = [
      run(1, 'pretrain', '2026-09-01T19:22:14Z'),
      run(2, 'pretrain-restart', '2026-09-01T19:22:21Z'),
    ];
    const b = bounds([
      [1, { minStep: 0, maxStep: 120 }],
      [2, { minStep: 100, maxStep: 300 }], // sys rows at steps 1–2 excluded
    ]);
    const plan = planMergeChain(runs, b, NO_ANCESTORS);
    expect(plan.links).toEqual([{ childId: 2n, parentId: 1n, forkStep: 99 }]);
  });

  it('breaks createdAt ties by id ascending', () => {
    const runs = [
      run(2, 'b', '2026-08-27T09:00:00Z'),
      run(1, 'a', '2026-08-27T09:00:00Z'),
    ];
    const b = bounds([
      [1, { minStep: 0, maxStep: 100 }],
      [2, { minStep: 50, maxStep: 180 }],
    ]);
    const plan = planMergeChain(runs, b, NO_ANCESTORS);
    expect(plan.links).toEqual([{ childId: 2n, parentId: 1n, forkStep: 49 }]);
  });
});

describe('getStepBoundsByRunId', () => {
  function mockCh(rows: Array<Record<string, unknown>>) {
    const captured = { query: '', params: undefined as Record<string, unknown> | undefined };
    const ch = {
      query: async (query: string, query_params?: Record<string, unknown>) => {
        captured.query = query;
        captured.params = query_params;
        return { json: async () => rows };
      },
    } as unknown as typeof clickhouse;
    return { ch, captured };
  }

  it('excludes SDK-auto-logged sys metrics from the bounds query', async () => {
    // sys/* rows use their own step counter starting near 1; if they were
    // included, a restart's minStep would collapse to ~1 and forkStep to 0.
    const { ch, captured } = mockCh([]);
    await getStepBoundsByRunId(ch, 'org-1', 'proj', [1n, 2n]);
    expect(captured.query).toContain("logGroup != 'sys'");
    expect(captured.params).toEqual({
      tenantId: 'org-1',
      projectName: 'proj',
      runIds: [1, 2],
    });
  });

  it('maps rows to BigInt-keyed numeric bounds and omits runs with no rows', async () => {
    const { ch } = mockCh([
      { runId: '2', minStep: '100', maxStep: '300' },
    ]);
    const map = await getStepBoundsByRunId(ch, 'org-1', 'proj', [1n, 2n]);
    expect(map.get(2n)).toEqual({ minStep: 100, maxStep: 300 });
    expect(map.has(1n)).toBe(false);
  });
});
