/**
 * Every ClickHouse query in lib/queries/*.ts must bind the caller's
 * organization as `tenantId`. ClickHouse has no row-level security: the
 * `tenantId = {tenantId: String}` predicate IS the tenant boundary, and a
 * query that forgets it reads every organization's metrics.
 *
 * The ClickHouse client is stubbed, every exported query function is called
 * with dummy arguments, and each SQL statement it issues (some issue several)
 * is checked for the predicate and for `query_params.tenantId` equal to the
 * organization id passed in. Exported functions that do not talk to
 * ClickHouse are enumerated explicitly, so a new export fails this test until
 * it is classified one way or the other.
 */
import { describe, expect, it, vi } from 'vitest';

// lib/clickhouse and lib/s3 construct clients from the validated env at import
// time; none of that is exercised here.
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

import type { clickhouse } from '../lib/clickhouse';
import * as metricSummaries from '../lib/queries/metric-summaries';
import * as projects from '../lib/queries/projects';
import * as runDetails from '../lib/queries/run-details';
import * as runFiles from '../lib/queries/run-files';
import * as runFilter from '../lib/queries/run-filter';
import * as runFilterGrammar from '../lib/queries/run-filter-grammar';
import * as runLogs from '../lib/queries/run-logs';
import * as runMetrics from '../lib/queries/run-metrics';
import * as runMetricsLineage from '../lib/queries/run-metrics-lineage';

const ORG = 'org_tenant_scope_test';
const PROJECT = 'tenant-scope-project';
const LOG = 'train/loss';

interface CapturedQuery {
  sql: string;
  params: Record<string, unknown> | undefined;
}

function fakeClickhouse(): { ch: typeof clickhouse; calls: CapturedQuery[] } {
  const calls: CapturedQuery[] = [];
  const ch = {
    query: vi.fn(async (sql: string, params: Record<string, unknown> | undefined) => {
      calls.push({ sql, params });
      return { json: async () => [] } as unknown;
    }),
  } as unknown as typeof clickhouse;
  return { ch, calls };
}

/** A Prisma stand-in for the lineage helper: no parent, so the chain is empty. */
const fakePrisma = {
  runs: {
    findFirst: async () => null,
    findUnique: async () => null,
    findMany: async () => [],
  },
} as never;

/**
 * Every exported function that reaches ClickHouse, with arguments that get
 * past its own validation. Keyed by module so the enumeration check below
 * can spot a new export.
 */
const CLICKHOUSE_QUERIES: Record<string, Record<string, (ch: typeof clickhouse) => Promise<unknown>>> = {
  'run-logs': {
    queryRunLogs: (ch) => runLogs.queryRunLogs(ch, { organizationId: ORG, projectName: PROJECT, runId: 1, limit: 10 }),
    queryAllRunLogs: (ch) => runLogs.queryAllRunLogs(ch, { organizationId: ORG, projectName: PROJECT, runId: 1 }),
  },
  'run-metrics': {
    queryRunMetrics: (ch) => runMetrics.queryRunMetrics(ch, { organizationId: ORG, projectName: PROJECT, runId: 1 }),
    queryRunMetricsByLogName: (ch) =>
      runMetrics.queryRunMetricsByLogName(ch, { organizationId: ORG, projectName: PROJECT, runId: 1, logName: LOG }),
    queryRunMetricsBucketedByLogName: (ch) =>
      runMetrics.queryRunMetricsBucketedByLogName(ch, { organizationId: ORG, projectName: PROJECT, runId: 1, logName: LOG }),
    queryRunMetricsBatchBucketedByLogName: (ch) =>
      runMetrics.queryRunMetricsBatchBucketedByLogName(ch, { organizationId: ORG, projectName: PROJECT, runIds: [1, 2], logName: LOG }),
    queryRunMetricsMultiMetricBatchBucketed: (ch) =>
      runMetrics.queryRunMetricsMultiMetricBatchBucketed(ch, { organizationId: ORG, projectName: PROJECT, runIds: [1, 2], logNames: [LOG] }),
    queryRunMetricsParametricBatchBucketed: (ch) =>
      runMetrics.queryRunMetricsParametricBatchBucketed(ch, {
        organizationId: ORG,
        projectName: PROJECT,
        runIds: [1, 2],
        logNames: [LOG],
        xMetric: 'train/step_time',
      }),
    queryRunsWithMetric: (ch) => runMetrics.queryRunsWithMetric(ch, { organizationId: ORG, projectName: PROJECT, runIds: [1, 2], logName: LOG }),
    queryRunMetricsGroupedBatchBucketed: (ch) =>
      runMetrics.queryRunMetricsGroupedBatchBucketed(ch, {
        organizationId: ORG,
        projectName: PROJECT,
        runGroupKeyMap: new Map([
          [1, 'group-a'],
          [2, 'group-b'],
        ]),
        logNames: [LOG],
      }),
    queryRunMetricsBatchByLogName: (ch) =>
      runMetrics.queryRunMetricsBatchByLogName(ch, { organizationId: ORG, projectName: PROJECT, runIds: [1, 2], logName: LOG }),
  },
  'run-files': {
    queryRunFiles: (ch) => runFiles.queryRunFiles(ch, { organizationId: ORG, projectName: PROJECT, runId: 1 }),
    queryRunFilesByLogName: (ch) => runFiles.queryRunFilesByLogName(ch, { organizationId: ORG, projectName: PROJECT, runId: 1, logName: 'images' }),
    queryRunFileTree: (ch) => runFiles.queryRunFileTree(ch, { organizationId: ORG, projectName: PROJECT, runId: 1 }),
    queryRunFileLogTypes: (ch) => runFiles.queryRunFileLogTypes(ch, { organizationId: ORG, projectName: PROJECT, runId: 1 }),
  },
  'run-metrics-lineage': {
    queryLineageMetricsBucketedByLogName: (ch) =>
      runMetricsLineage.queryLineageMetricsBucketedByLogName(ch, fakePrisma, { organizationId: ORG, projectName: PROJECT, runId: 1, logName: LOG }),
  },
  'metric-summaries': {
    queryMetricSummariesBatch: (ch) =>
      metricSummaries.queryMetricSummariesBatch(ch, {
        organizationId: ORG,
        projectName: PROJECT,
        metrics: [{ logName: LOG, aggregation: 'LAST' }],
        runIds: [1, 2],
      }),
    queryArgminArgmaxSteps: (ch) => metricSummaries.queryArgminArgmaxSteps(ch, { organizationId: ORG, projectName: PROJECT, logName: LOG, runIds: [1, 2] }),
    queryArgminArgmaxStepsPerImageLog: (ch) =>
      metricSummaries.queryArgminArgmaxStepsPerImageLog(ch, { organizationId: ORG, projectName: PROJECT, logName: LOG, runIds: [1, 2], toleranceSteps: 20 }),
    queryDistinctMetrics: (ch) => metricSummaries.queryDistinctMetrics(ch, { organizationId: ORG, projectName: PROJECT }),
    queryMetricSortedRunIds: (ch) =>
      metricSummaries.queryMetricSortedRunIds(ch, {
        organizationId: ORG,
        projectName: PROJECT,
        sortLogName: LOG,
        sortAggregation: 'LAST',
        sortDirection: 'ASC',
        limit: 10,
        offset: 0,
      }),
    queryHeartbeatSortedRunIds: (ch) =>
      metricSummaries.queryHeartbeatSortedRunIds(ch, { organizationId: ORG, projectName: PROJECT, sortDirection: 'ASC', limit: 10, offset: 0 }),
    queryRunHeartbeats: (ch) => metricSummaries.queryRunHeartbeats(ch, { organizationId: ORG, projectName: PROJECT, runIds: [1, 2] }),
    queryHeartbeatFilteredRunIds: (ch) =>
      metricSummaries.queryHeartbeatFilteredRunIds(ch, { organizationId: ORG, projectName: PROJECT, after: '2024-01-01T00:00:00Z' }),
    queryMetricFilteredRunIds: (ch) =>
      metricSummaries.queryMetricFilteredRunIds(ch, {
        organizationId: ORG,
        projectName: PROJECT,
        metricFilters: [{ logName: LOG, aggregation: 'LAST', operator: '>', values: [0.5] }],
      }),
    queryRunMetricValuesByLogName: (ch) =>
      metricSummaries.queryRunMetricValuesByLogName(ch, { organizationId: ORG, projectName: PROJECT, logName: LOG, aggregation: 'LAST' }),
    queryRunMetricValues: (ch) => metricSummaries.queryRunMetricValues(ch, { organizationId: ORG, projectName: PROJECT, runId: 1 }),
  },
};

/** Exported functions that never issue a ClickHouse query themselves, and why. */
const NOT_CLICKHOUSE: Record<string, Record<string, string>> = {
  'run-metrics': {
    toColumnar: 'pure: row → columnar reshaping of an already-fetched series',
    toColumnarParametric: 'pure: row → columnar reshaping of an already-fetched series',
  },
  'run-files': {
    getRunFileUrl: 'S3 presigned URL; the key is built from the organizationId argument, no ClickHouse',
  },
  'run-metrics-lineage': {
    resolveLineageChain: 'Prisma only: walks forkedFromRunId under an organizationId-scoped lookup',
  },
  'run-details': {
    queryRunDetails: 'Prisma only',
  },
  projects: {
    queryProjects: 'Prisma only',
    queryAllProjects: 'Prisma only',
  },
  'run-filter': {
    compileRunFilter: 'Prisma-driven; its ClickHouse legs go through the metric-summaries helpers covered here',
    FilterError: 'error class',
  },
  'run-filter-grammar': {
    isKnownFilterField: 'pure grammar helper',
  },
};

const MODULES: Record<string, Record<string, unknown>> = {
  'run-logs': runLogs,
  'run-metrics': runMetrics,
  'run-files': runFiles,
  'run-metrics-lineage': runMetricsLineage,
  'metric-summaries': metricSummaries,
  'run-details': runDetails,
  projects,
  'run-filter': runFilter,
  'run-filter-grammar': runFilterGrammar,
};

const TENANT_PREDICATE = /tenantId\s*=\s*\{tenantId:\s*String\}/;

describe('lib/queries: every ClickHouse query is scoped to the tenant', () => {
  it('classifies every exported function of every query module', () => {
    const unclassified: string[] = [];
    for (const [name, module] of Object.entries(MODULES)) {
      for (const [exportName, value] of Object.entries(module)) {
        if (typeof value !== 'function') {
          continue;
        }
        const covered = CLICKHOUSE_QUERIES[name]?.[exportName] !== undefined;
        const excused = NOT_CLICKHOUSE[name]?.[exportName] !== undefined;
        if (!covered && !excused) {
          unclassified.push(`${name}.${exportName}`);
        }
      }
    }
    expect(
      unclassified,
      'New exported query function(s). Add each to CLICKHOUSE_QUERIES (with arguments) or to NOT_CLICKHOUSE (with a reason) in this test.',
    ).toEqual([]);
  });

  for (const [moduleName, functions] of Object.entries(CLICKHOUSE_QUERIES)) {
    describe(moduleName, () => {
      for (const [functionName, invoke] of Object.entries(functions)) {
        it(`${functionName} binds tenantId = organizationId on every statement`, async () => {
          const { ch, calls } = fakeClickhouse();
          try {
            await invoke(ch);
          } catch (error) {
            // An empty result set may make the function throw after it has
            // queried; what matters is what it sent. It must have sent something.
            if (calls.length === 0) {
              throw error;
            }
          }
          expect(calls.length, `${functionName} issued no ClickHouse query`).toBeGreaterThan(0);
          for (const [index, call] of calls.entries()) {
            const label = `${functionName} statement #${index + 1}:\n${call.sql.trim().slice(0, 600)}`;
            expect(call.sql, `${label}\n— has no tenantId predicate`).toMatch(TENANT_PREDICATE);
            expect(call.params?.tenantId, `${label}\n— tenantId param is not the organizationId passed in`).toBe(ORG);
          }
        });
      }
    });
  }
});
