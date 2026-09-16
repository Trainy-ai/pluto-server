/**
 * Unit tests for the machinery behind tests/tenant-isolation.test.ts. These
 * run everywhere (no server): they prove the input synthesizer serves every
 * org-scoped procedure in the inventory, that the coverage guard really
 * fails for an unlisted procedure, and that the allowlists and overrides
 * name procedures that still exist.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { MEMBERSHIP_ALLOWLIST, REST_ALLOWLIST, SCOPING_ALLOWLIST } from './tenant-isolation/allowlist';
import { auditCoverage, auditRestCoverage, describeGaps, type CheckKind } from './tenant-isolation/coverage';
import { inputValuesFor, type OrgIdentifiers } from './tenant-isolation/identifiers';
import { PROCEDURE_OVERRIDES } from './tenant-isolation/overrides';
import { REST_CHECKS, type RestIdentifiers } from './tenant-isolation/rest-endpoints';
import {
  defaultScopingExpectation,
  flattenSchema,
  identifierKeysIn,
  synthesizeInput,
  type JsonSchema,
} from './tenant-isolation/synthesize-input';

interface InventoryProcedure {
  path: string;
  type: string;
  auth: string;
  input: JsonSchema | null;
}

const HERE = dirname(fileURLToPath(import.meta.url));
const inventory = JSON.parse(
  readFileSync(join(HERE, '..', '..', '..', 'docs', 'api-surface.json'), 'utf8'),
) as { procedures: InventoryProcedure[]; rest: Array<{ method: string; path: string }> };
const orgProcedures = inventory.procedures.filter((procedure) => procedure.auth === 'session+org');

const foreign: OrgIdentifiers = {
  id: 'org-2',
  projectName: 'org2-test-project',
  runId: 'sqidA',
  runIds: ['sqidA', 'sqidB'],
  dashboardViewId: '77',
  runTableViewId: '88',
  sweepId: 'org2sweep1',
  memberId: 'member-2',
  invitationId: 'invite-2',
  apiKeyId: 'key-2',
  notificationIds: [42],
  newOwnerId: 'user-2',
  logName: 'org2/only-metric',
};

const restIds: RestIdentifiers = {
  projectName: 'org2-test-project',
  runId: 123,
  runIds: [123, 124],
  displayId: 'OTP-1',
  viewId: '77',
  logName: 'org2/only-metric',
  foreignOrgId: 'org-2',
  runSqids: ['sqidA'],
  ownOrgId: 'org-1',
};

describe('synthesizeInput', () => {
  it('serves every session+org procedure in the inventory with all required keys populated', () => {
    expect(orgProcedures.length).toBeGreaterThan(50);
    for (const procedure of orgProcedures) {
      const input = synthesizeInput(procedure.input, inputValuesFor(procedure.path, 'org-1', foreign));
      const required = flattenSchema(procedure.input).required ?? [];
      for (const key of required) {
        expect(input, `${procedure.path}: required key "${key}" not synthesized`).toHaveProperty(key);
        expect(input[key], `${procedure.path}: required key "${key}" is undefined`).not.toBeUndefined();
      }
      expect(input.organizationId, procedure.path).toBe('org-1');
    }
  });

  it('substitutes the foreign identifiers wherever the schema names them, at any depth', () => {
    const get = (path: string) => orgProcedures.find((procedure) => procedure.path === path)!;
    expect(synthesizeInput(get('runs.get').input, inputValuesFor('runs.get', 'org-1', foreign))).toEqual({
      organizationId: 'org-1',
      projectName: 'org2-test-project',
      runId: 'sqidA',
    });
    expect(synthesizeInput(get('runs.merge').input, inputValuesFor('runs.merge', 'org-1', foreign)).runIds).toEqual(['sqidA', 'sqidB']);
    // viewId means different rows to the two view routers
    expect(synthesizeInput(get('dashboardViews.get').input, inputValuesFor('dashboardViews.get', 'org-1', foreign)).viewId).toBe('77');
    expect(synthesizeInput(get('runTableViews.get').input, inputValuesFor('runTableViews.get', 'org-1', foreign)).viewId).toBe('88');
    // nested: metricSummaries.metrics[].logName
    const summaries = synthesizeInput(get('runs.metricSummaries').input, inputValuesFor('runs.metricSummaries', 'org-1', foreign));
    expect((summaries.metrics as Array<{ logName: string }>)[0].logName).toBe('org2/only-metric');
    // optional identifiers are still injected so the check is meaningful
    expect(synthesizeInput(get('runs.latest').input, inputValuesFor('runs.latest', 'org-1', foreign)).projectName).toBe('org2-test-project');
  });

  it('respects enums, numeric bounds, formats and array bounds', () => {
    const schema: JsonSchema = {
      type: 'object',
      required: ['role', 'version', 'limit', 'email', 'when', 'items', 'notes', 'kind'],
      properties: {
        role: { type: 'string', enum: ['OWNER', 'ADMIN'] },
        version: { type: 'integer', exclusiveMinimum: 0 },
        limit: { type: 'number', minimum: 10, maximum: 20 },
        email: { type: 'string', format: 'email' },
        when: { type: 'string', format: 'date-time' },
        items: { type: 'array', items: { type: 'string' }, minItems: 2, maxItems: 3 },
        notes: { anyOf: [{ type: 'string', maxLength: 5 }, { type: 'null' }] },
        kind: { type: ['string', 'null'] },
      },
    };
    expect(synthesizeInput(schema, {})).toEqual({
      role: 'OWNER',
      version: 1,
      limit: 10,
      email: 'tenant-isolation@example.com',
      when: '2024-01-01T00:00:00.000Z',
      items: ['tenant-isolation', 'tenant-isolation'],
      notes: 'tenant-isolation',
      kind: 'tenant-isolation',
    });
  });
});

describe('defaultScopingExpectation', () => {
  const get = (path: string) => orgProcedures.find((procedure) => procedure.path === path)!.input;

  it('demands rejection when a row identifier is required', () => {
    expect(defaultScopingExpectation(get('runs.get'))).toBe('reject');
    expect(defaultScopingExpectation(get('runs.trigger.createTrigger'))).toBe('reject');
    expect(defaultScopingExpectation(get('runTableViews.update'))).toBe('reject');
    expect(defaultScopingExpectation(get('organization.removeMember'))).toBe('reject');
  });

  it('accepts an empty answer for container-only or optional identifiers', () => {
    expect(defaultScopingExpectation(get('runs.list'))).toBe('no-leak');
    expect(defaultScopingExpectation(get('runs.latest'))).toBe('no-leak');
    expect(defaultScopingExpectation(get('runs.data.eligiblePrefixes'))).toBe('no-leak');
  });

  it('dashboard view procedures publish viewId as optional (z.coerce.string) and are forced to reject by override', () => {
    for (const path of ['dashboardViews.get', 'dashboardViews.delete', 'dashboardViews.update', 'dashboardViews.restoreVersion']) {
      expect(defaultScopingExpectation(get(path)), path).toBe('no-leak');
      expect(PROCEDURE_OVERRIDES[path]?.expect, path).toBe('reject');
    }
  });

  it('skips inputs that name nothing beyond organizationId', () => {
    expect(defaultScopingExpectation(get('organization.listMembers'))).toBe('skip');
    expect(identifierKeysIn(get('organization.listMembers'))).toEqual({ present: [], required: [] });
  });

  it('classifies most org-scoped procedures as checkable', () => {
    const counts = { reject: 0, 'no-leak': 0, skip: 0 };
    for (const procedure of orgProcedures) {
      counts[defaultScopingExpectation(procedure.input)] += 1;
    }
    expect(counts.reject).toBeGreaterThan(30);
    expect(counts['no-leak']).toBeGreaterThan(15);
    expect(counts.skip).toBeLessThan(25);
  });
});

describe('coverage guard', () => {
  const recordedFor = (paths: string[], checks: CheckKind[]) =>
    new Map(paths.map((path) => [path, new Set(checks)] as const));

  it('reports an org-scoped procedure that no check exercised', () => {
    const procedures = [
      { path: 'runs.get', auth: 'session+org' },
      { path: 'zzz.brandNewProc', auth: 'session+org' },
      { path: 'auth', auth: 'public' },
    ];
    const report = auditCoverage({
      procedures,
      recorded: recordedFor(['runs.get'], ['membership', 'scoping']),
      autoSkipped: new Map(),
      membershipAllowlist: {},
      scopingAllowlist: {},
      overrides: {},
    });
    expect(report.missing).toEqual([
      { path: 'zzz.brandNewProc', check: 'membership' },
      { path: 'zzz.brandNewProc', check: 'scoping' },
    ]);
    expect(describeGaps(report)).toContain('zzz.brandNewProc (membership)');
  });

  it('accepts an allowlisted or auto-skipped procedure, and flags stale entries', () => {
    const procedures = [{ path: 'organization.listMembers', auth: 'session+org' }];
    const report = auditCoverage({
      procedures,
      recorded: recordedFor(['organization.listMembers'], ['membership']),
      autoSkipped: new Map([['organization.listMembers', 'no identifier']]),
      membershipAllowlist: {},
      scopingAllowlist: { 'gone.proc': 'was removed' },
      overrides: { 'also.gone': {} },
    });
    expect(report.missing).toEqual([]);
    expect(report.stale).toEqual(['gone.proc', 'also.gone']);
  });

  it('a membership-only record still leaves the scoping check missing', () => {
    const report = auditCoverage({
      procedures: [{ path: 'runs.get', auth: 'session+org' }],
      recorded: recordedFor(['runs.get'], ['membership']),
      autoSkipped: new Map(),
      membershipAllowlist: {},
      scopingAllowlist: {},
      overrides: {},
    });
    expect(report.missing).toEqual([{ path: 'runs.get', check: 'scoping' }]);
  });

  it('reports REST endpoints with neither a check nor an allowlist entry', () => {
    const report = auditRestCoverage(
      [
        { method: 'GET', path: '/api/runs/list' },
        { method: 'POST', path: '/api/new/thing' },
      ],
      new Set(['GET /api/runs/list']),
      { 'GET /api/stale': 'gone' },
    );
    expect(report.missing).toEqual(['POST /api/new/thing']);
    expect(report.stale).toEqual(['GET /api/stale']);
  });
});

describe('allowlists, overrides and REST table against the current inventory', () => {
  it('every allowlist and override entry names a procedure that exists', () => {
    const report = auditCoverage({
      procedures: inventory.procedures,
      recorded: new Map(),
      autoSkipped: new Map(),
      membershipAllowlist: MEMBERSHIP_ALLOWLIST,
      scopingAllowlist: SCOPING_ALLOWLIST,
      overrides: PROCEDURE_OVERRIDES,
    });
    expect(report.stale).toEqual([]);
  });

  it('the REST table plus allowlist covers every inventoried endpoint, and names no phantom ones', () => {
    const inventoried = REST_CHECKS.filter((check) => check.inventoried !== false).map((check) => check.key);
    const report = auditRestCoverage(inventory.rest, new Set(inventoried), REST_ALLOWLIST);
    expect(report.missing, describeGaps(report)).toEqual([]);
    expect(report.stale, describeGaps(report)).toEqual([]);
    const known = new Set(inventory.rest.map((endpoint) => `${endpoint.method} ${endpoint.path}`));
    expect(inventoried.filter((key) => !known.has(key))).toEqual([]);
  });

  it('every REST builder produces a request that embeds the foreign identifiers', () => {
    for (const check of REST_CHECKS) {
      const request = check.build(restIds);
      const serialized = `${request.path} ${JSON.stringify(request.query ?? {})} ${JSON.stringify(request.body ?? {})}`;
      const carriesForeignId = ['123', 'OTP-1', 'org2-test-project', '77', 'sqidA'].some((marker) => serialized.includes(marker));
      expect(carriesForeignId, `${check.key}: ${serialized}`).toBe(true);
    }
  });
});
