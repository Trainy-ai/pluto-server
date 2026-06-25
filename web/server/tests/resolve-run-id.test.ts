/**
 * Tests for resolveRunIdsResilient — the batch resolver used by the
 * histogram/bars batch procs. Unlike the single-run resolveRunId (which throws
 * on a bad id), the batch variant must SKIP unresolvable runs so one deleted or
 * unauthorized id can't 500 the whole widget.
 *
 * Run with: vitest run tests/resolve-run-id.test.ts
 */

import { describe, it, expect } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { resolveRunIdsResilient } from '../lib/resolve-run-id';

// Minimal Prisma stub: a display-id lookup (`PREFIX-N`) resolves only when the
// run "exists" (here: even numbers), otherwise findFirst returns null and
// resolveRunId throws "Run not found".
function makePrisma(existingNumbers: Set<number>): PrismaClient {
  return {
    runs: {
      findFirst: async ({ where }: { where: { number: number } }) =>
        existingNumbers.has(where.number) ? { id: where.number * 10 } : null,
    },
  } as unknown as PrismaClient;
}

describe('resolveRunIdsResilient', () => {
  it('keeps resolvable runs and silently drops the unresolvable ones', async () => {
    const prisma = makePrisma(new Set([1, 3]));
    const resolved = await resolveRunIdsResilient(
      prisma,
      ['ABC-1', 'ABC-2', 'ABC-3'],
      'org',
      'proj',
    );
    // ABC-2 is "deleted" → skipped; 1 and 3 resolve to number*10.
    const byEnc = Object.fromEntries(resolved.map((r) => [r.enc, r.num]));
    expect(byEnc).toEqual({ 'ABC-1': 10, 'ABC-3': 30 });
  });

  it('returns an empty array when every run is unresolvable', async () => {
    const prisma = makePrisma(new Set());
    const resolved = await resolveRunIdsResilient(
      prisma,
      ['ZZZ-7', 'ZZZ-8'],
      'org',
      'proj',
    );
    expect(resolved).toEqual([]);
  });

  it('does not reject (throw) even when an id is malformed', async () => {
    const prisma = makePrisma(new Set([5]));
    // "!!!" is neither a display id nor a decodable SQID → resolveRunId throws,
    // but the resilient batch resolver must swallow it.
    await expect(
      resolveRunIdsResilient(prisma, ['QQQ-5', '!!!'], 'org', 'proj'),
    ).resolves.toEqual([{ enc: 'QQQ-5', num: 50 }]);
  });
});
