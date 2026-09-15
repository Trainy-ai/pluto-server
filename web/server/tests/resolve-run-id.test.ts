/**
 * Tests for the run-id resolver — the ownership gate every run-scoped proc
 * relies on.
 *
 * A SQID is a reversible encoding of the GLOBAL autoincrement id, so any
 * signed-in user can mint the SQID of any run in any organization. The
 * resolver must therefore refuse a SQID unless the run belongs to the caller's
 * (organization, project); cache only positive answers; verify a batch with a
 * single query; and, in the resilient variant, SKIP unresolvable runs so one
 * deleted or unauthorized id can't 500 a whole widget.
 *
 * Run with: vitest run tests/resolve-run-id.test.ts
 */

import { describe, it, expect } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { TRPCError } from '@trpc/server';
import { sqidEncode } from '../lib/sqid';
import {
  resolveRunId,
  resolveRunIds,
  resolveRunIdsResilient,
} from '../lib/resolve-run-id';

interface FindManyWhere {
  id: { in: number[] };
  organizationId: string;
  project?: { name: string };
}

interface StubOptions {
  /** Display-id numbers (`PREFIX-N`) that exist; findFirst resolves N → id N*10. */
  displayNumbers?: Set<number>;
  /** Numeric run ids owned by `ownerOrg` (and `ownerProject`, when set). */
  ownedIds?: Set<number>;
  ownerOrg?: string;
  ownerProject?: string;
}

// Minimal Prisma stub. Display ids go through `runs.findFirst`; SQID
// ownership goes through ONE `runs.findMany` whose `where` is recorded so
// tests can assert the org/project scoping and the batch shape.
function makePrisma(opts: StubOptions = {}) {
  const displayNumbers = opts.displayNumbers ?? new Set<number>();
  const ownedIds = opts.ownedIds ?? new Set<number>();
  const calls = { findFirst: 0, findMany: 0, findManyWhere: [] as FindManyWhere[] };
  const prisma = {
    runs: {
      findFirst: async ({ where }: { where: { number: number } }) => {
        calls.findFirst++;
        return displayNumbers.has(where.number) ? { id: BigInt(where.number * 10) } : null;
      },
      findMany: async ({ where }: { where: FindManyWhere }) => {
        calls.findMany++;
        calls.findManyWhere.push(where);
        const orgOk = where.organizationId === opts.ownerOrg;
        const projectOk = !where.project || where.project.name === opts.ownerProject;
        if (!orgOk || !projectOk) return [];
        return where.id.in.filter((id) => ownedIds.has(id)).map((id) => ({ id: BigInt(id) }));
      },
    },
  } as unknown as PrismaClient;
  return { prisma, calls, ownedIds };
}

// The ownership cache is module-level and keyed by organization, so every test
// uses its own organization id to stay independent of the others.
let orgCounter = 0;
function freshOrg(): string {
  return `org-${++orgCounter}`;
}

async function expectTrpcError(p: Promise<unknown>, code: TRPCError['code']) {
  await expect(p).rejects.toBeInstanceOf(TRPCError);
  await expect(p).rejects.toMatchObject({ code });
}

describe('resolveRunId — SQID ownership', () => {
  it("resolves a SQID that belongs to the caller's organization and project", async () => {
    const org = freshOrg();
    const { prisma, calls } = makePrisma({ ownedIds: new Set([42]), ownerOrg: org, ownerProject: 'proj' });

    await expect(resolveRunId(prisma, sqidEncode(42), org, 'proj')).resolves.toBe(42);

    expect(calls.findMany).toBe(1);
    expect(calls.findManyWhere[0]).toEqual({
      id: { in: [42] },
      organizationId: org,
      project: { name: 'proj' },
    });
  });

  it('throws NOT_FOUND for a SQID of a run in another organization (cross-tenant guard)', async () => {
    const victim = freshOrg();
    const attacker = freshOrg();
    // The attacker knows the victim's project name (unique per org, not globally)
    // and the run's SQID — exactly the pentest scenario.
    const { prisma, calls } = makePrisma({ ownedIds: new Set([42]), ownerOrg: victim, ownerProject: 'proj' });

    await expectTrpcError(resolveRunId(prisma, sqidEncode(42), attacker, 'proj'), 'NOT_FOUND');
    expect(calls.findMany).toBe(1);
    expect(calls.findManyWhere[0].organizationId).toBe(attacker);
  });

  it('throws NOT_FOUND for a run in the caller\'s org but a different project', async () => {
    const org = freshOrg();
    const { prisma } = makePrisma({ ownedIds: new Set([42]), ownerOrg: org, ownerProject: 'proj-a' });

    await expectTrpcError(resolveRunId(prisma, sqidEncode(42), org, 'proj-b'), 'NOT_FOUND');
  });

  it('omits the project filter when no project name is given', async () => {
    const org = freshOrg();
    const { prisma, calls } = makePrisma({ ownedIds: new Set([42]), ownerOrg: org });

    await expect(resolveRunId(prisma, sqidEncode(42), org)).resolves.toBe(42);
    expect(calls.findManyWhere[0]).toEqual({ id: { in: [42] }, organizationId: org });
  });

  it('serves a repeat lookup from the ownership cache without touching the DB', async () => {
    const org = freshOrg();
    const { prisma, calls } = makePrisma({ ownedIds: new Set([42]), ownerOrg: org, ownerProject: 'proj' });

    await resolveRunId(prisma, sqidEncode(42), org, 'proj');
    await expect(resolveRunId(prisma, sqidEncode(42), org, 'proj')).resolves.toBe(42);

    expect(calls.findMany).toBe(1);
  });

  it('does not cache a miss', async () => {
    const org = freshOrg();
    const { prisma, calls, ownedIds } = makePrisma({ ownedIds: new Set(), ownerOrg: org, ownerProject: 'proj' });

    await expectTrpcError(resolveRunId(prisma, sqidEncode(42), org, 'proj'), 'NOT_FOUND');
    // The run "appears" (e.g. created after a racing lookup) — must be re-checked.
    ownedIds.add(42);
    await expect(resolveRunId(prisma, sqidEncode(42), org, 'proj')).resolves.toBe(42);

    expect(calls.findMany).toBe(2);
  });

  it('scopes the ownership cache to the organization', async () => {
    const owner = freshOrg();
    const other = freshOrg();
    const { prisma, calls } = makePrisma({ ownedIds: new Set([42]), ownerOrg: owner, ownerProject: 'proj' });

    // Warm the cache as the owner, then ask as another org: the cached
    // positive must NOT be reused across organizations.
    await resolveRunId(prisma, sqidEncode(42), owner, 'proj');
    await expectTrpcError(resolveRunId(prisma, sqidEncode(42), other, 'proj'), 'NOT_FOUND');

    expect(calls.findMany).toBe(2);
  });

  it('scopes the ownership cache to the project', async () => {
    const org = freshOrg();
    const { prisma, calls } = makePrisma({ ownedIds: new Set([42]), ownerOrg: org, ownerProject: 'proj-a' });

    await resolveRunId(prisma, sqidEncode(42), org, 'proj-a');
    await expectTrpcError(resolveRunId(prisma, sqidEncode(42), org, 'proj-b'), 'NOT_FOUND');

    expect(calls.findMany).toBe(2);
  });

  it('throws BAD_REQUEST for a malformed identifier without querying', async () => {
    const { prisma, calls } = makePrisma({ ownerOrg: freshOrg() });

    await expectTrpcError(resolveRunId(prisma, '!!!', freshOrg(), 'proj'), 'BAD_REQUEST');
    expect(calls.findMany).toBe(0);
  });

  it('throws BAD_REQUEST for a SQID that decodes beyond the safe-integer range', async () => {
    const { prisma, calls } = makePrisma({ ownerOrg: freshOrg() });

    // sqids decodes any alphabet-only string; this one decodes to ~1.5e23,
    // which is not a valid BigInt run id and must not reach Postgres.
    await expectTrpcError(resolveRunId(prisma, 'NoSuchRunIdXYZ', freshOrg(), 'proj'), 'BAD_REQUEST');
    expect(calls.findMany).toBe(0);
  });
});

describe('resolveRunId — display ids', () => {
  it('resolves a display id through the org-scoped lookup', async () => {
    const { prisma, calls } = makePrisma({ displayNumbers: new Set([7]) });

    await expect(resolveRunId(prisma, 'ABC-7', freshOrg(), 'proj')).resolves.toBe(70);
    expect(calls.findFirst).toBe(1);
    expect(calls.findMany).toBe(0);
  });

  it('throws a NOT_FOUND TRPCError for an unknown display id', async () => {
    const { prisma } = makePrisma({ displayNumbers: new Set() });

    await expectTrpcError(resolveRunId(prisma, 'ABC-9', freshOrg(), 'proj'), 'NOT_FOUND');
  });
});

describe('resolveRunIds — batch', () => {
  it('verifies N uncached SQIDs with exactly one query and preserves input order', async () => {
    const org = freshOrg();
    const { prisma, calls } = makePrisma({
      displayNumbers: new Set([2]),
      ownedIds: new Set([7, 3, 9]),
      ownerOrg: org,
      ownerProject: 'proj',
    });

    const resolved = await resolveRunIds(
      prisma,
      [sqidEncode(7), 'ABC-2', sqidEncode(3), sqidEncode(9)],
      org,
      'proj',
    );

    expect(resolved).toEqual([7, 20, 3, 9]);
    expect(calls.findMany).toBe(1);
    expect([...calls.findManyWhere[0].id.in].sort((a, b) => a - b)).toEqual([3, 7, 9]);
    expect(calls.findManyWhere[0].organizationId).toBe(org);
    expect(calls.findManyWhere[0].project).toEqual({ name: 'proj' });
    expect(calls.findFirst).toBe(1);
  });

  it('throws NOT_FOUND when any SQID is not owned, but still caches the ones that are', async () => {
    const org = freshOrg();
    const { prisma, calls } = makePrisma({ ownedIds: new Set([1]), ownerOrg: org, ownerProject: 'proj' });

    await expectTrpcError(resolveRunIds(prisma, [sqidEncode(1), sqidEncode(999)], org, 'proj'), 'NOT_FOUND');
    expect(calls.findMany).toBe(1);

    // Run 1 was confirmed by that query — a follow-up lookup is cache-served.
    await expect(resolveRunId(prisma, sqidEncode(1), org, 'proj')).resolves.toBe(1);
    expect(calls.findMany).toBe(1);
  });

  it('skips the query entirely when every SQID is already cached', async () => {
    const org = freshOrg();
    const { prisma, calls } = makePrisma({ ownedIds: new Set([5, 6]), ownerOrg: org, ownerProject: 'proj' });

    await resolveRunIds(prisma, [sqidEncode(5), sqidEncode(6)], org, 'proj');
    await expect(resolveRunIds(prisma, [sqidEncode(6), sqidEncode(5)], org, 'proj')).resolves.toEqual([6, 5]);

    expect(calls.findMany).toBe(1);
  });

  it('de-duplicates repeated ids in the query', async () => {
    const org = freshOrg();
    const { prisma, calls } = makePrisma({ ownedIds: new Set([5]), ownerOrg: org, ownerProject: 'proj' });

    await expect(resolveRunIds(prisma, [sqidEncode(5), sqidEncode(5)], org, 'proj')).resolves.toEqual([5, 5]);
    expect(calls.findManyWhere[0].id.in).toEqual([5]);
  });

  it('rejects with BAD_REQUEST before any DB work when an id is malformed', async () => {
    const { prisma, calls } = makePrisma({ displayNumbers: new Set([2]), ownerOrg: freshOrg() });

    await expectTrpcError(resolveRunIds(prisma, ['ABC-2', '!!!'], freshOrg(), 'proj'), 'BAD_REQUEST');
    expect(calls.findFirst).toBe(0);
    expect(calls.findMany).toBe(0);
  });
});

describe('resolveRunIdsResilient', () => {
  it('keeps resolvable display ids and silently drops the unresolvable ones', async () => {
    const { prisma } = makePrisma({ displayNumbers: new Set([1, 3]) });
    const resolved = await resolveRunIdsResilient(
      prisma,
      ['ABC-1', 'ABC-2', 'ABC-3'],
      freshOrg(),
      'proj',
    );
    // ABC-2 is "deleted" → skipped; 1 and 3 resolve to number*10.
    const byEnc = Object.fromEntries(resolved.map((r) => [r.enc, r.num]));
    expect(byEnc).toEqual({ 'ABC-1': 10, 'ABC-3': 30 });
  });

  it('returns an empty array when every run is unresolvable', async () => {
    const { prisma } = makePrisma({ displayNumbers: new Set() });
    const resolved = await resolveRunIdsResilient(
      prisma,
      ['ZZZ-7', 'ZZZ-8'],
      freshOrg(),
      'proj',
    );
    expect(resolved).toEqual([]);
  });

  it('does not reject (throw) even when an id is malformed', async () => {
    const { prisma } = makePrisma({ displayNumbers: new Set([5]) });
    // "!!!" is neither a display id nor a decodable SQID → the strict resolvers
    // throw, but the resilient batch resolver must swallow it.
    await expect(
      resolveRunIdsResilient(prisma, ['QQQ-5', '!!!'], freshOrg(), 'proj'),
    ).resolves.toEqual([{ enc: 'QQQ-5', num: 50 }]);
  });

  it("drops SQIDs from another organization and keeps the caller's own, in one query", async () => {
    const org = freshOrg();
    const { prisma, calls } = makePrisma({
      displayNumbers: new Set([4]),
      ownedIds: new Set([1, 2]),
      ownerOrg: org,
      ownerProject: 'proj',
    });

    const resolved = await resolveRunIdsResilient(
      prisma,
      [sqidEncode(1), sqidEncode(3), 'ABC-4', sqidEncode(2)],
      org,
      'proj',
    );

    const byEnc = Object.fromEntries(resolved.map((r) => [r.enc, r.num]));
    expect(byEnc).toEqual({ [sqidEncode(1)]: 1, [sqidEncode(2)]: 2, 'ABC-4': 40 });
    expect(calls.findMany).toBe(1);
  });

  it('returns nothing when the whole batch belongs to another organization', async () => {
    const victim = freshOrg();
    const { prisma } = makePrisma({ ownedIds: new Set([1, 2]), ownerOrg: victim, ownerProject: 'proj' });

    await expect(
      resolveRunIdsResilient(prisma, [sqidEncode(1), sqidEncode(2)], freshOrg(), 'proj'),
    ).resolves.toEqual([]);
  });
});
