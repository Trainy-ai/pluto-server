/**
 * The API-key (REST) half of the tenant-isolation suite.
 *
 * The OpenAPI document does not carry enough to synthesize these requests
 * (path templates and body schemas live in Zod, not in docs/api-surface.json),
 * so each endpoint that takes a run id, display id, project name or view id
 * is listed by hand. `key` is the `METHOD /path` string the inventory prints;
 * the coverage guard fails for any inventoried endpoint with neither a check
 * here nor an entry in allowlist.ts, so a new route cannot slip by unlisted.
 *
 * Every request is sent with org 1's API key and org 2's identifiers.
 */

export interface RestIdentifiers {
  projectName: string;
  /** numeric id of the primary fixture run (the REST surface uses numeric ids) */
  runId: number;
  runIds: number[];
  /** `PREFIX-N` display id of the primary fixture run */
  displayId: string;
  /** numeric DashboardView id, as a string (the routes take it as a string) */
  viewId: string;
  logName: string;
  /** the other tenant's organization id and run SQIDs (the chart-data route speaks tRPC's dialect) */
  foreignOrgId: string;
  runSqids: string[];
  /** the organization the bearer key belongs to */
  ownOrgId: string;
}

export interface RestRequest {
  method: 'GET' | 'POST';
  path: string;
  query?: Record<string, string>;
  body?: unknown;
}

export interface RestCheck {
  /** `METHOD /path-template`, exactly as docs/api-surface.json prints it */
  key: string;
  /** distinguishes several checks of one endpoint in test titles */
  variant?: string;
  /** see `defaultScopingExpectation` in synthesize-input.ts */
  expect: 'reject' | 'no-leak';
  /** re-read org 2's state afterwards and require it unchanged */
  mutation: boolean;
  /** endpoints outside the OpenAPI document (the `other` list) — not audited for coverage */
  inventoried?: false;
  build: (foreign: RestIdentifiers) => RestRequest;
}

const q = (values: Record<string, string | number | undefined>): Record<string, string> =>
  Object.fromEntries(
    Object.entries(values)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => [key, String(value)]),
  );

export const REST_CHECKS: RestCheck[] = [
  // ---- reads addressed by run id --------------------------------------------
  {
    key: 'GET /api/runs/details/{runId}',
    expect: 'reject',
    mutation: false,
    build: (f) => ({ method: 'GET', path: `/api/runs/details/${f.runId}` }),
  },
  {
    key: 'GET /api/runs/details/by-display-id/{displayId}',
    expect: 'reject',
    mutation: false,
    build: (f) => ({
      method: 'GET',
      path: `/api/runs/details/by-display-id/${encodeURIComponent(f.displayId)}`,
      query: q({ projectName: f.projectName }),
    }),
  },
  {
    key: 'GET /api/runs/logs',
    // ClickHouse-backed read scoped by the key's tenantId: a foreign run id yields an
    // empty 200 rather than 404 (same design as the direct-decode tRPC procs).
    expect: 'no-leak',
    mutation: false,
    build: (f) => ({ method: 'GET', path: '/api/runs/logs', query: q({ runId: f.runId, projectName: f.projectName }) }),
  },
  {
    key: 'GET /api/runs/metrics',
    // ClickHouse-backed read scoped by the key's tenantId: a foreign run id yields an
    // empty 200 rather than 404 (same design as the direct-decode tRPC procs).
    expect: 'no-leak',
    mutation: false,
    build: (f) => ({ method: 'GET', path: '/api/runs/metrics', query: q({ runId: f.runId, projectName: f.projectName }) }),
  },
  {
    key: 'GET /api/runs/metrics/raw',
    // ClickHouse-backed read scoped by the key's tenantId: a foreign run id yields an
    // empty 200 rather than 404 (same design as the direct-decode tRPC procs).
    expect: 'no-leak',
    mutation: false,
    build: (f) => ({
      method: 'GET',
      path: '/api/runs/metrics/raw',
      query: q({ runId: f.runId, projectName: f.projectName, logName: f.logName }),
    }),
  },
  {
    key: 'GET /api/runs/files',
    // ClickHouse-backed read scoped by the key's tenantId: a foreign run id yields an
    // empty 200 rather than 404 (same design as the direct-decode tRPC procs).
    expect: 'no-leak',
    mutation: false,
    build: (f) => ({ method: 'GET', path: '/api/runs/files', query: q({ runId: f.runId, projectName: f.projectName }) }),
  },
  {
    key: 'GET /api/runs/statistics',
    expect: 'reject',
    mutation: false,
    build: (f) => ({ method: 'GET', path: '/api/runs/statistics', query: q({ runId: f.runId, projectName: f.projectName }) }),
  },
  {
    key: 'GET /api/runs/status/history',
    expect: 'reject',
    mutation: false,
    build: (f) => ({ method: 'GET', path: '/api/runs/status/history', query: q({ runId: f.runId }) }),
  },
  {
    key: 'GET /api/runs/compare',
    expect: 'no-leak',
    mutation: false,
    build: (f) => ({
      method: 'GET',
      path: '/api/runs/compare',
      query: q({ runIds: f.runIds.join(','), projectName: f.projectName, logName: f.logName }),
    }),
  },

  // ---- reads addressed by project name ----------------------------------------
  {
    key: 'GET /api/runs/list',
    expect: 'no-leak',
    mutation: false,
    build: (f) => ({ method: 'GET', path: '/api/runs/list', query: q({ projectName: f.projectName }) }),
  },
  {
    key: 'GET /api/runs/metric-names',
    expect: 'no-leak',
    mutation: false,
    build: (f) => ({ method: 'GET', path: '/api/runs/metric-names', query: q({ projectName: f.projectName }) }),
  },
  {
    key: 'GET /api/runs/leaderboard',
    expect: 'no-leak',
    mutation: false,
    build: (f) => ({
      method: 'GET',
      path: '/api/runs/leaderboard',
      query: q({ projectName: f.projectName, logName: f.logName }),
    }),
  },

  // ---- writes addressed by run id ---------------------------------------------
  {
    key: 'POST /api/runs/status/update',
    expect: 'reject',
    mutation: true,
    build: (f) => ({ method: 'POST', path: '/api/runs/status/update', body: { runId: f.runId, status: 'CANCELLED' } }),
  },
  {
    key: 'POST /api/runs/logName/add',
    expect: 'reject',
    mutation: true,
    build: (f) => ({
      method: 'POST',
      path: '/api/runs/logName/add',
      body: { runId: f.runId, logName: ['tenant-isolation/injected'], logType: 'METRIC' },
    }),
  },
  {
    key: 'POST /api/runs/tags/update',
    expect: 'reject',
    mutation: true,
    build: (f) => ({ method: 'POST', path: '/api/runs/tags/update', body: { runId: f.runId, tags: ['tenant-isolation'] } }),
  },
  {
    key: 'POST /api/runs/notes/update',
    expect: 'reject',
    mutation: true,
    build: (f) => ({ method: 'POST', path: '/api/runs/notes/update', body: { runId: f.runId, notes: 'tenant-isolation' } }),
  },
  {
    key: 'POST /api/runs/config/update',
    expect: 'reject',
    mutation: true,
    build: (f) => ({
      method: 'POST',
      path: '/api/runs/config/update',
      // the endpoint takes the config as a JSON string, not an object
      body: { runId: f.runId, config: JSON.stringify({ tenantIsolation: 'injected' }) },
    }),
  },
  {
    key: 'POST /api/runs/modelGraph/create',
    expect: 'reject',
    mutation: true,
    build: (f) => ({
      method: 'POST',
      path: '/api/runs/modelGraph/create',
      body: { runId: f.runId, graph: { format: 'tenant-isolation', nodes: {} } },
    }),
  },
  {
    key: 'POST /api/runs/resume',
    variant: 'by runId',
    expect: 'reject',
    mutation: true,
    build: (f) => ({ method: 'POST', path: '/api/runs/resume', body: { runId: f.runId } }),
  },
  {
    key: 'POST /api/runs/resume',
    variant: 'by displayId',
    expect: 'reject',
    mutation: true,
    build: (f) => ({
      method: 'POST',
      path: '/api/runs/resume',
      body: { displayId: f.displayId, projectName: f.projectName },
    }),
  },

  // ---- dashboards -------------------------------------------------------------
  {
    key: 'GET /api/dashboards/list',
    expect: 'no-leak',
    mutation: false,
    build: (f) => ({ method: 'GET', path: '/api/dashboards/list', query: q({ projectName: f.projectName }) }),
  },
  {
    key: 'GET /api/dashboards/details/{viewId}',
    expect: 'reject',
    mutation: false,
    build: (f) => ({ method: 'GET', path: `/api/dashboards/details/${f.viewId}` }),
  },
  {
    key: 'GET /api/dashboards/details/{viewId}/versions',
    expect: 'reject',
    mutation: false,
    build: (f) => ({ method: 'GET', path: `/api/dashboards/details/${f.viewId}/versions` }),
  },
  {
    key: 'GET /api/dashboards/details/{viewId}/versions/{version}',
    expect: 'reject',
    mutation: false,
    build: (f) => ({ method: 'GET', path: `/api/dashboards/details/${f.viewId}/versions/1` }),
  },
  {
    key: 'POST /api/dashboards/create',
    expect: 'no-leak',
    mutation: true,
    build: (f) => ({
      method: 'POST',
      path: '/api/dashboards/create',
      body: { projectName: f.projectName, name: 'tenant-isolation' },
    }),
  },
  {
    key: 'POST /api/dashboards/update',
    expect: 'reject',
    mutation: true,
    build: (f) => ({ method: 'POST', path: '/api/dashboards/update', body: { viewId: f.viewId, name: 'tenant-isolation' } }),
  },
  {
    key: 'POST /api/dashboards/restore',
    expect: 'reject',
    mutation: true,
    build: (f) => ({
      method: 'POST',
      path: '/api/dashboards/restore',
      body: { viewId: f.viewId, version: 1, expectedUpdatedAt: '2024-01-01T00:00:00.000Z' },
    }),
  },

  // ---- hybrid-auth chart endpoint (outside the OpenAPI document) -------------
  // The bearer key's org must match `organizationId` exactly, and a matching
  // org must still not resolve another tenant's run SQIDs.
  {
    key: 'GET /api/chart-data/multi-metric-batch-bucketed',
    variant: "other tenant's organizationId",
    expect: 'reject',
    mutation: false,
    inventoried: false,
    build: (f) => chartDataRequest(f.foreignOrgId, f),
  },
  {
    key: 'GET /api/chart-data/multi-metric-batch-bucketed',
    variant: "own organizationId, other tenant's runs",
    expect: 'reject',
    mutation: false,
    inventoried: false,
    build: (f) => chartDataRequest(f.ownOrgId, f),
  },
];

function chartDataRequest(organizationId: string, f: RestIdentifiers): RestRequest {
  return {
    method: 'GET',
    path: '/api/chart-data/multi-metric-batch-bucketed',
    query: {
      input: JSON.stringify({
        organizationId,
        projectName: f.projectName,
        runIds: f.runSqids,
        logNames: [f.logName],
      }),
    },
  };
}
