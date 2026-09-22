/**
 * Experiments view: media widgets (images/video/audio/files, histograms) must
 * stitch a merged/forked run's lineage the same way the line charts do —
 * each ancestor contributes only the steps up to its child's fork step, all
 * returned under the requested run. Regression for a merged experiment whose
 * `eval-images` panel showed only the last run's 62K-70K steps while loss
 * was stitched end to end.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../lib/env', () => ({
  env: {
    STORAGE_ENDPOINT: 'http://localhost:9000',
    STORAGE_ACCESS_KEY_ID: 'test',
    STORAGE_SECRET_ACCESS_KEY: 'test',
    STORAGE_BUCKET: 'test',
    STORAGE_REGION: 'us-east-1',
    CLICKHOUSE_URL: 'http://localhost:8123',
    CLICKHOUSE_USER: 'default',
    CLICKHOUSE_PASSWORD: 'test',
    DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
    DATABASE_DIRECT_URL: 'postgresql://test:test@localhost:5432/test',
    PUBLIC_URL: 'http://localhost:3001',
    BETTER_AUTH_URL: 'http://localhost:3000',
    BETTER_AUTH_SECRET: 'test-secret',
    NODE_ENV: 'test',
  },
}));
vi.mock('../lib/redis', () => ({
  getRedisClient: vi.fn().mockResolvedValue(null),
  isRedisAvailable: vi.fn().mockReturnValue(false),
}));
vi.mock('../lib/s3', () => ({
  getImageUrl: vi.fn(
    async (_org: string, _proj: string, runId: number, logName: string, fileName: string) =>
      `https://s3/${runId}/${logName}/${fileName}`,
  ),
}));

import { clearL1Cache } from '../lib/cache';
import { queryRunFilesByLogName } from '../lib/queries/run-files';
import { queryRunFilesWithLineage } from '../trpc/routers/runs/routers/data/procs/files-batch';
import { lineageHistogramSource } from '../trpc/routers/runs/routers/data/procs/histogram-batch';
import { attributeLogsToChains } from '../trpc/routers/runs/procs/run-ids-by-log-name';

const ORG = 'org-1';
const PROJECT = 'proj';
const LOG = 'eval-images';

interface FileRow {
  runId: number;
  step: number;
  fileName: string;
}

/**
 * ClickHouse stub that actually applies the runId / step bounds the query
 * binds, so a missing or wrong bound shows up as wrong rows, not just a
 * wrong SQL string.
 */
function fakeClickhouse(rows: FileRow[]) {
  const calls: { sql: string; params: Record<string, unknown> }[] = [];
  const ch = {
    query: vi.fn(async (sql: string, params: Record<string, unknown>) => {
      calls.push({ sql, params });
      const out = rows
        .filter((r) => r.runId === params.runId)
        .filter((r) => params.stepMin === undefined || r.step >= (params.stepMin as number))
        .filter((r) => params.stepMax === undefined || r.step <= (params.stepMax as number))
        .map((r) => ({
          time: '2026-01-01 00:00:00',
          step: r.step,
          fileName: r.fileName,
          fileType: 'png',
          caption: null,
          annotations: null,
        }));
      return { json: async () => out };
    }),
  };
  return { ch, calls };
}

/** Prisma stub serving the lineage walk and withCache's run-status lookup. */
function prismaWith(runs: { id: number; forkedFromRunId: number | null; forkStep: number | null }[]) {
  const byId = new Map(runs.map((r) => [BigInt(r.id), r]));
  const toRow = (r: (typeof runs)[number]) => ({
    id: BigInt(r.id),
    forkedFromRunId: r.forkedFromRunId != null ? BigInt(r.forkedFromRunId) : null,
    forkStep: r.forkStep != null ? BigInt(r.forkStep) : null,
    status: 'COMPLETED',
  });
  return {
    runs: {
      findFirst: vi.fn(async ({ where }: { where: { id: bigint } }) => {
        const r = byId.get(where.id);
        return r ? toRow(r) : null;
      }),
      findUnique: vi.fn(async ({ where }: { where: { id: bigint } }) => {
        const r = byId.get(where.id);
        return r ? toRow(r) : null;
      }),
      findMany: vi.fn(async ({ where }: { where: { id: { in: bigint[] } } }) =>
        where.id.in.map((id) => byId.get(id)).filter(Boolean).map((r) => toRow(r!)),
      ),
    },
  };
}

// Three-run experiment like the reported one: A (0-30K) → B forked at 30K
// → C forked at 62K. Every run kept logging images past the step its
// successor resumed from; those overlap rows must NOT be stitched in.
const LINEAGE = [
  { id: 1, forkedFromRunId: null, forkStep: null },
  { id: 2, forkedFromRunId: 1, forkStep: 30_000 },
  { id: 3, forkedFromRunId: 2, forkStep: 62_000 },
];
const FILES: FileRow[] = [
  { runId: 1, step: 10_000, fileName: 'a-10k.png' },
  { runId: 1, step: 30_000, fileName: 'a-30k.png' },
  { runId: 1, step: 35_000, fileName: 'a-35k-overlap.png' },
  { runId: 2, step: 30_000, fileName: 'b-30k-overlap.png' },
  { runId: 2, step: 40_000, fileName: 'b-40k.png' },
  { runId: 2, step: 62_000, fileName: 'b-62k.png' },
  { runId: 2, step: 64_000, fileName: 'b-64k-overlap.png' },
  { runId: 3, step: 62_000, fileName: 'c-62k-overlap.png' },
  { runId: 3, step: 70_000, fileName: 'c-70k.png' },
];

describe('queryRunFilesByLogName step bounds', () => {
  it('binds inclusive stepMin/stepMax only when given', async () => {
    const { ch, calls } = fakeClickhouse(FILES);
    await queryRunFilesByLogName(ch as never, {
      organizationId: ORG, projectName: PROJECT, runId: 2, logName: LOG, stepMin: 30_001, stepMax: 62_000,
    });
    expect(calls[0].sql).toContain('step >= {stepMin: UInt64}');
    expect(calls[0].sql).toContain('step <= {stepMax: UInt64}');
    expect(calls[0].params).toMatchObject({ stepMin: 30_001, stepMax: 62_000, tenantId: ORG });

    await queryRunFilesByLogName(ch as never, {
      organizationId: ORG, projectName: PROJECT, runId: 2, logName: LOG,
    });
    expect(calls[1].sql).not.toContain('stepMin');
    expect(calls[1].sql).not.toContain('stepMax');
    expect(calls[1].params).not.toHaveProperty('stepMin');
    expect(calls[1].params).not.toHaveProperty('stepMax');
  });
});

describe('queryRunFilesWithLineage', () => {
  beforeEach(() => clearL1Cache());

  it('stitches every segment in step order, excluding steps a successor re-logged', async () => {
    const { ch } = fakeClickhouse(FILES);
    const files = await queryRunFilesWithLineage(
      { prisma: prismaWith(LINEAGE) as never, clickhouse: ch as never },
      { organizationId: ORG, projectName: PROJECT, runId: 3, logName: LOG, includeLineage: true },
    );
    expect(files.map((f) => f.fileName)).toEqual([
      'a-10k.png',
      'a-30k.png',
      'b-40k.png',
      'b-62k.png',
      'c-70k.png',
    ]);
  });

  it("builds each file's presigned URL from the run that logged it", async () => {
    const { ch } = fakeClickhouse(FILES);
    const files = await queryRunFilesWithLineage(
      { prisma: prismaWith(LINEAGE) as never, clickhouse: ch as never },
      { organizationId: ORG, projectName: PROJECT, runId: 3, logName: LOG, includeLineage: true },
    );
    const urlOf = (name: string) => files.find((f) => f.fileName === name)?.url;
    expect(urlOf('a-10k.png')).toBe(`https://s3/1/${LOG}/a-10k.png`);
    expect(urlOf('b-40k.png')).toBe(`https://s3/2/${LOG}/b-40k.png`);
    expect(urlOf('c-70k.png')).toBe(`https://s3/3/${LOG}/c-70k.png`);
  });

  it('without includeLineage reads only the requested run, unbounded (unchanged behaviour)', async () => {
    const { ch, calls } = fakeClickhouse(FILES);
    const prisma = prismaWith(LINEAGE);
    const files = await queryRunFilesWithLineage(
      { prisma: prisma as never, clickhouse: ch as never },
      { organizationId: ORG, projectName: PROJECT, runId: 3, logName: LOG },
    );
    expect(files.map((f) => f.fileName)).toEqual(['c-62k-overlap.png', 'c-70k.png']);
    expect(calls).toHaveLength(1);
    expect(prisma.runs.findFirst).not.toHaveBeenCalled();
  });

  it('a run with no ancestors is a single unbounded read even with includeLineage', async () => {
    const { ch, calls } = fakeClickhouse(FILES);
    const files = await queryRunFilesWithLineage(
      { prisma: prismaWith(LINEAGE) as never, clickhouse: ch as never },
      { organizationId: ORG, projectName: PROJECT, runId: 1, logName: LOG, includeLineage: true },
    );
    expect(files).toHaveLength(3);
    expect(calls).toHaveLength(1);
    expect(calls[0].params).not.toHaveProperty('stepMin');
    expect(calls[0].params).not.toHaveProperty('stepMax');
  });

  it('reflects a merge immediately — the chain is resolved per request, not cached', async () => {
    const { ch } = fakeClickhouse(FILES);
    const unmerged = LINEAGE.map((r) => ({ ...r, forkedFromRunId: null, forkStep: null }));
    const before = await queryRunFilesWithLineage(
      { prisma: prismaWith(unmerged) as never, clickhouse: ch as never },
      { organizationId: ORG, projectName: PROJECT, runId: 3, logName: LOG, includeLineage: true },
    );
    const after = await queryRunFilesWithLineage(
      { prisma: prismaWith(LINEAGE) as never, clickhouse: ch as never },
      { organizationId: ORG, projectName: PROJECT, runId: 3, logName: LOG, includeLineage: true },
    );
    expect(before.map((f) => f.fileName)).toEqual(['c-62k-overlap.png', 'c-70k.png']);
    expect(after).toHaveLength(5);
  });
});

describe('lineageHistogramSource', () => {
  const segments = [
    { runId: 1, minStep: 0, maxStep: 30_000 },
    { runId: 2, minStep: 30_001, maxStep: 62_000 },
    { runId: 3, minStep: 62_001, maxStep: null },
  ];

  it('reads each segment from its own run, bounded to the steps it owns', () => {
    const { source, params } = lineageHistogramSource(3, segments);
    expect(source.split('UNION ALL')).toHaveLength(3);
    expect(params).toMatchObject({
      runId_0: 1, stepMax_0: 30_000,
      runId_1: 2, stepMin_1: 30_001, stepMax_1: 62_000,
      runId_2: 3, stepMin_2: 62_001,
    });
    // Root has no lower bound; the requested run has no upper bound.
    expect(params).not.toHaveProperty('stepMin_0');
    expect(params).not.toHaveProperty('stepMax_2');
  });

  it('relabels every row with the requested run and stays tenant-scoped', () => {
    const { source, params } = lineageHistogramSource(3, segments);
    expect(params.requestedRunId).toBe(3);
    const branches = source.split('UNION ALL');
    for (const branch of branches) {
      expect(branch).toContain('toUInt64({requestedRunId: UInt64}) AS runId');
      // The runId filter must be in an inner scope: ClickHouse resolves a
      // WHERE identifier to a same-scope SELECT alias, so filtering next to
      // `AS runId` would compare the relabelled id and read the wrong runs.
      expect(branch).toMatch(/AS runId, logName, time, step, data\s+FROM \(\s+SELECT logName, time, step, data\s+FROM mlop_data/);
      expect(branch).toContain('tenantId = {tenantId: String}');
      expect(branch).toContain('projectName = {projectName: String}');
    }
  });
});

describe('attributeLogsToChains', () => {
  it('credits a run with a log only an ancestor logged', () => {
    const chains = new Map([
      [3n, [3n, 2n, 1n]],
      [9n, [9n]],
    ]);
    const result = attributeLogsToChains(chains, [
      { logName: 'eval-images', runId: 1n },
      { logName: 'train/hist', runId: 9n },
    ]);
    expect(result.get('eval-images')).toEqual([3n]);
    expect(result.get('train/hist')).toEqual([9n]);
  });

  it('lists a requested run once even when several chain members logged the name', () => {
    const chains = new Map([[3n, [3n, 2n, 1n]]]);
    const result = attributeLogsToChains(chains, [
      { logName: 'eval-images', runId: 1n },
      { logName: 'eval-images', runId: 2n },
      { logName: 'eval-images', runId: 3n },
    ]);
    expect(result.get('eval-images')).toEqual([3n]);
  });

  it('with single-run chains behaves like the plain lookup', () => {
    const chains = new Map([
      [1n, [1n]],
      [2n, [2n]],
    ]);
    const result = attributeLogsToChains(chains, [{ logName: 'eval-images', runId: 2n }]);
    expect(result.get('eval-images')).toEqual([2n]);
  });
});
