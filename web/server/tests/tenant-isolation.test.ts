/**
 * Tenant isolation, generated from the API inventory.
 *
 * Pentest finding 3.1 was three procedures that accepted another
 * organization's run SQID. The fix (lib/resolve-run-id.ts) closed those, but
 * tenancy is a property of every org-scoped procedure, and hand-written
 * per-procedure tests cannot keep up with the surface. This suite instead
 * reads docs/api-surface.json and, for EVERY `session+org` procedure, runs:
 *
 *   1. Membership: a user who belongs to org 2 only calls it with org 1's
 *      organizationId and org 1's identifiers → UNAUTHORIZED (401), never 200.
 *      Proves `protectedOrgProcedure` gates the procedure at all.
 *
 *   2. Resource scoping: a member of org 1 calls it with org 1's
 *      organizationId but every resource identifier taken from org 2 (its
 *      project name, run SQIDs, view ids, sweep id, member/invitation/API-key
 *      ids …) → NOT_FOUND/FORBIDDEN, or an empty 200 that carries none of
 *      org 2's marker strings. Procedures whose input names nothing beyond
 *      `organizationId` are skipped here (the membership check covers them)
 *      and the skip is recorded so the coverage guard can see it.
 *
 *   After every cross-tenant MUTATION, org 2's state is re-read under org 2's
 *   own organizationId and must equal the baseline taken before the loop.
 *
 * A BAD_REQUEST (400) from Zod means the synthesized input was invalid — that
 * would be a false pass, so it FAILS with instructions to add an override
 * (tests/tenant-isolation/overrides.ts). Procedures excused from a check are
 * listed with a reason in tests/tenant-isolation/allowlist.ts, and a final
 * guard fails CI for any org-scoped procedure or REST endpoint that is
 * neither exercised nor allowlisted.
 *
 * The same loop then runs over the REST surface with org 1's API key and
 * org 2's numeric run id, display id, project name and view id.
 *
 * Fixtures come from tests/setup.ts (§2c, §6b): org 2 owns one of every
 * resource, each carrying an `org2-…` marker, plus a metric whose every value
 * is 424242.42 so a leaked series is visible even when the body is numbers.
 *
 * Without a reachable server the whole file is skipped, like the other smoke
 * suites. With a server but missing fixtures it FAILS rather than skipping,
 * so a silently empty run cannot hide a regression.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

import { MEMBERSHIP_ALLOWLIST, REST_ALLOWLIST, SCOPING_ALLOWLIST } from './tenant-isolation/allowlist';
import {
  auditCoverage,
  auditRestCoverage,
  describeGaps,
  type CheckKind,
} from './tenant-isolation/coverage';
import { inputValuesFor, type OrgIdentifiers } from './tenant-isolation/identifiers';
import { PROCEDURE_OVERRIDES } from './tenant-isolation/overrides';
import { REST_CHECKS, type RestIdentifiers } from './tenant-isolation/rest-endpoints';
import {
  defaultScopingExpectation,
  synthesizeInput,
  type JsonSchema,
} from './tenant-isolation/synthesize-input';

// ---------------------------------------------------------------------------
// Environment (written to .env.test by tests/setup.ts)
// ---------------------------------------------------------------------------

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:3001';
const ORG1_API_KEY = process.env.TEST_API_KEY || '';
const ORG1_SLUG = process.env.TEST_ORG_SLUG || 'smoke-test-org';
const ORG1_PROJECT = process.env.TEST_PROJECT_NAME || 'smoke-test-project';
const ORG2_SLUG = process.env.TEST_ORG2_SLUG || 'smoke-test-org-2';
const ORG2_PROJECT = process.env.TEST_ORG2_PROJECT_NAME || 'org2-test-project';
const ORG2_API_KEY = process.env.TEST_ORG2_API_KEY || '';
const SMOKE_EMAIL = process.env.TEST_USER_EMAIL || 'test-smoke@mlop.local';
const ORG2_ONLY_EMAIL = process.env.TEST_ORG2_ONLY_USER_EMAIL || 'smoke-org2-only@example.com';
const PASSWORD = 'TestPassword123!';

const ORG2_RUN_NAME = 'org2-unique-run';
const ORG2_SWEEP_RUN_NAME = 'org2-sweep-run';
const ORG2_METRIC = 'org2/only-metric';
/** Seeded next to ORG2_METRIC but never sent in a request, so its name and value are pure leak markers. */
const ORG2_CANARY_METRIC = 'org2/leak-canary-metric';
const ORG2_DASHBOARD_NAME = 'Org2 Tenant Dashboard';
const ORG2_TABLE_VIEW_NAME = 'Org2 Tenant Table View';
const ORG2_SWEEP_ID = 'org2sweep1';

/** Strings seeded only into org 2. None may appear in a response to a request made under org 1. */
const STATIC_ORG2_MARKERS = [
  ORG2_RUN_NAME,
  ORG2_SWEEP_RUN_NAME,
  'org2-only-tag',
  'org2-only-notes',
  'org2-only-config-value',
  '424242.42',
  ORG2_CANARY_METRIC,
  '313131.31',
  ORG2_DASHBOARD_NAME,
  ORG2_TABLE_VIEW_NAME,
  'Org2 Only Section',
  ORG2_SWEEP_ID,
  'org2-only-invitee@example.com',
  'org2-only-notification',
  ORG2_ONLY_EMAIL,
];

// ---------------------------------------------------------------------------
// Inventory
// ---------------------------------------------------------------------------

interface InventoryProcedure {
  path: string;
  type: 'query' | 'mutation' | 'subscription';
  auth: string;
  input: JsonSchema | null;
}

interface Inventory {
  procedures: InventoryProcedure[];
  rest: Array<{ method: string; path: string }>;
}

const HERE = dirname(fileURLToPath(import.meta.url));
const INVENTORY_PATH = join(HERE, '..', '..', '..', 'docs', 'api-surface.json');
const inventory = JSON.parse(readFileSync(INVENTORY_PATH, 'utf8')) as Inventory;
const orgProcedures = inventory.procedures.filter((procedure) => procedure.auth === 'session+org');

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

interface TrpcResponse {
  status: number;
  code: string | null;
  body: any;
  text: string;
  data: any;
}

async function trpc(
  procedure: string,
  type: InventoryProcedure['type'],
  input: Record<string, unknown>,
  cookie: string,
): Promise<TrpcResponse> {
  // tRPC v11 + superjson: the wire format is the envelope `{"json": <input>}`.
  const envelope = JSON.stringify({ json: input });
  const method = type === 'mutation' ? 'POST' : 'GET';
  const url = new URL(`${BASE_URL}/trpc/${procedure}`);
  if (method === 'GET') {
    url.searchParams.set('input', envelope);
  }
  const response = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: method === 'POST' ? envelope : undefined,
  });
  const text = await response.text();
  let body: any = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = null;
  }
  return {
    status: response.status,
    code: body?.error?.json?.data?.code ?? body?.error?.data?.code ?? null,
    body,
    text,
    data: body?.result?.data?.json ?? body?.result?.data,
  };
}

interface RestResponse {
  status: number;
  text: string;
  body: any;
}

async function rest(
  method: 'GET' | 'POST',
  path: string,
  apiKey: string,
  options: { query?: Record<string, string>; body?: unknown } = {},
): Promise<RestResponse> {
  const url = new URL(`${BASE_URL}${path}`);
  for (const [key, value] of Object.entries(options.query ?? {})) {
    url.searchParams.set(key, value);
  }
  const response = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: method === 'POST' ? JSON.stringify(options.body ?? {}) : undefined,
  });
  const text = await response.text();
  let body: any = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = null;
  }
  return { status: response.status, text, body };
}

async function probeServer(): Promise<boolean> {
  try {
    const response = await fetch(`${BASE_URL}/api/health`, { signal: AbortSignal.timeout(3000) });
    return response.status === 200;
  } catch {
    return false;
  }
}

async function signIn(email: string): Promise<string> {
  const response = await fetch(`${BASE_URL}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  // better-auth names the cookie `better-auth.session_token`; accept the
  // older underscore spelling too so a library upgrade does not silently
  // turn every check into a skip.
  const match = (response.headers.get('set-cookie') ?? '').match(/(better[-_]auth\.session_token)=([^;]+)/);
  if (!match) {
    throw new Error(
      `Sign-in as ${email} failed (HTTP ${response.status}): ${await response.text()}. ` +
        'Run `pnpm test:setup` so the tenant-isolation users exist.',
    );
  }
  return `${match[1]}=${match[2]}`;
}

// ---------------------------------------------------------------------------
// Fixture discovery: everything is read back through the API as the smoke
// user (a member of both orgs), the way the app itself addresses resources.
// ---------------------------------------------------------------------------

function required<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined || value === '') {
    throw new Error(`Tenant-isolation fixture missing: ${what}. Run \`pnpm test:setup\` (tests/setup.ts §6b).`);
  }
  return value;
}

async function ok(procedure: string, type: InventoryProcedure['type'], input: Record<string, unknown>, cookie: string): Promise<any> {
  const response = await trpc(procedure, type, input, cookie);
  if (response.status !== 200) {
    throw new Error(`${procedure} failed while collecting fixtures: HTTP ${response.status} ${response.text.slice(0, 300)}`);
  }
  return response.data;
}

interface CollectOptions {
  runName: string;
  dashboardName?: string;
  tableViewName?: string;
  sweepId?: string;
  memberEmail?: string;
  logName: string;
  /** org 1 has no seeded invitation/notification; a plausible placeholder is fine there because the membership check is rejected before the input is read */
  lenient: boolean;
}

async function collectOrg(cookie: string, orgId: string, projectName: string, opts: CollectOptions): Promise<OrgIdentifiers> {
  const scoped = (input: Record<string, unknown>) => ({ organizationId: orgId, ...input });
  const pick = <T>(value: T | undefined, what: string, fallback: T): T =>
    opts.lenient ? (value ?? fallback) : required(value, what);

  const runs = (await ok('runs.list', 'query', scoped({ projectName, limit: 50 }), cookie))?.runs as
    | Array<{ id: string; name: string }>
    | undefined;
  const primary = runs?.find((run) => run.name === opts.runName) ?? runs?.[0];
  const runId = pick(primary?.id, `run ${opts.runName} in ${projectName}`, 'missing-run');
  const runIds = (runs ?? []).map((run) => run.id);
  if (runIds.length < 2) {
    if (!opts.lenient) {
      throw new Error(`Tenant-isolation fixture missing: at least two runs in ${projectName} (runs.merge needs two)`);
    }
    runIds.push(runId, runId);
  }

  const dashboards = (await ok('dashboardViews.list', 'query', scoped({ projectName }), cookie))?.views as
    | Array<{ id: string; name: string }>
    | undefined;
  const dashboard = opts.dashboardName ? dashboards?.find((view) => view.name === opts.dashboardName) : dashboards?.[0];
  const dashboardViewId = pick(dashboard?.id, `dashboard view "${opts.dashboardName}"`, '1');

  const tableViews = (await ok('runTableViews.list', 'query', scoped({ projectName }), cookie))?.views as
    | Array<{ id: string; name: string }>
    | undefined;
  const tableView = opts.tableViewName ? tableViews?.find((view) => view.name === opts.tableViewName) : tableViews?.[0];
  const runTableViewId = pick(tableView?.id, `run table view "${opts.tableViewName}"`, '1');

  const sweeps = (await ok('sweeps.list', 'query', scoped({ projectName }), cookie))?.sweeps as
    | Array<{ sweepId: string }>
    | undefined;
  const sweep = opts.sweepId ? sweeps?.find((entry) => entry.sweepId === opts.sweepId) : sweeps?.[0];
  const sweepId = pick(sweep?.sweepId, `sweep ${opts.sweepId}`, 'missing-sweep');

  const members = (await ok('organization.listMembers', 'query', scoped({}), cookie)) as
    | Array<{ id: string; user: { id: string; email: string } }>
    | undefined;
  const member = opts.memberEmail ? members?.find((entry) => entry.user.email === opts.memberEmail) : members?.[0];
  const memberId = pick(member?.id, `membership of ${opts.memberEmail}`, 'missing-member');
  const newOwnerId = pick(member?.user.id, `user ${opts.memberEmail}`, 'missing-user');

  const invites = (await ok('organization.invite.listSentInvites', 'query', scoped({}), cookie)) as
    | Array<{ id: string }>
    | undefined;
  const invitationId = pick(invites?.[0]?.id, 'a pending invitation', 'missing-invitation');

  const apiKeys = (await ok('organization.apiKey.listApiKeys', 'query', scoped({}), cookie)) as
    | Array<{ id: string }>
    | undefined;
  const apiKeyId = pick(apiKeys?.[0]?.id, 'an API key', 'missing-api-key');

  const notifications = (await ok('organization.notifications.list', 'query', scoped({ limit: 5 }), cookie))?.items as
    | Array<{ id: number | string }>
    | undefined;
  const notificationId = notifications?.[0]?.id;
  const notificationIds = [Number(pick(notificationId, 'a notification', 0))].filter((id) => Number.isFinite(id));

  return {
    id: orgId,
    projectName,
    runId,
    runIds,
    dashboardViewId,
    runTableViewId,
    sweepId,
    memberId,
    invitationId,
    apiKeyId,
    notificationIds: notificationIds.length > 0 ? notificationIds : [0],
    newOwnerId,
    logName: opts.logName,
  };
}

// ---------------------------------------------------------------------------
// org 2 state snapshot — must be identical before and after every
// cross-tenant mutation.
// ---------------------------------------------------------------------------

async function org2Snapshot(cookie: string, org2: OrgIdentifiers): Promise<Record<string, unknown>> {
  const read = async (procedure: string, input: Record<string, unknown>) => {
    const response = await trpc(procedure, 'query', { organizationId: org2.id, ...input }, cookie);
    return response.status === 200 ? stripVolatile(response.data) : { status: response.status, code: response.code };
  };
  const [runs, run, triggers, lineage, dashboards, dashboard, tableViews, tableView, members, invites, apiKeys, unread, layout, sweeps, projects] =
    await Promise.all([
      read('runs.list', { projectName: org2.projectName, limit: 50 }),
      read('runs.get', { projectName: org2.projectName, runId: org2.runId }),
      read('runs.trigger.getTrigger', { projectName: org2.projectName, runId: org2.runId }),
      read('runs.getLineage', { projectName: org2.projectName, runId: org2.runId }),
      read('dashboardViews.list', { projectName: org2.projectName }),
      read('dashboardViews.get', { viewId: org2.dashboardViewId }),
      read('runTableViews.list', { projectName: org2.projectName }),
      read('runTableViews.get', { viewId: org2.runTableViewId }),
      read('organization.listMembers', {}),
      read('organization.invite.listSentInvites', {}),
      read('organization.apiKey.listApiKeys', {}),
      read('organization.notifications.count', { read: false }),
      read('chartsLayout.get', { projectName: org2.projectName }),
      read('sweeps.list', { projectName: org2.projectName }),
      read('projects.count', {}),
    ]);
  return { runs, run, triggers, lineage, dashboards, dashboard, tableViews, tableView, members, invites, apiKeys, unread, layout, sweeps, projects };
}

/** Drop fields that change on read rather than on write. */
function stripVolatile(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stripVolatile);
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (key === 'lastUsed') {
        continue;
      }
      out[key] = stripVolatile(entry);
    }
    return out;
  }
  return value;
}

// ---------------------------------------------------------------------------
// Coverage bookkeeping
// ---------------------------------------------------------------------------

const recorded = new Map<string, Set<CheckKind>>();
const autoSkipped = new Map<string, string>();
const exercisedRest = new Set<string>();

function record(path: string, check: CheckKind): void {
  const set = recorded.get(path) ?? new Set<CheckKind>();
  set.add(check);
  recorded.set(path, set);
}

function leakedMarkers(text: string, markers: string[]): string[] {
  return markers.filter((marker) => marker.length > 0 && text.includes(marker));
}

// ---------------------------------------------------------------------------
// The suite
// ---------------------------------------------------------------------------

const serverAvailable = await probeServer();
if (!serverAvailable) {
  console.log(`   Tenant-isolation suite skipped: no server at ${BASE_URL}`);
}

describe.skipIf(!serverAvailable)('Tenant Isolation (generated from docs/api-surface.json)', () => {
  let smokeCookie = '';
  let org2OnlyCookie = '';
  let org1: OrgIdentifiers;
  let org2: OrgIdentifiers;
  let markers: string[] = [];
  let baseline: Record<string, unknown>;
  let restIds: RestIdentifiers;

  beforeAll(async () => {
    smokeCookie = await signIn(SMOKE_EMAIL);
    org2OnlyCookie = await signIn(ORG2_ONLY_EMAIL);

    const auth = await ok('auth', 'query', {}, smokeCookie);
    const orgs = (auth?.allOrgs ?? []) as Array<{ id: string; slug: string }>;
    const org1Id = required(orgs.find((org) => org.slug === ORG1_SLUG)?.id, `organization ${ORG1_SLUG}`);
    const org2Id = required(orgs.find((org) => org.slug === ORG2_SLUG)?.id, `organization ${ORG2_SLUG}`);
    expect(org1Id).not.toBe(org2Id);

    org2 = await collectOrg(smokeCookie, org2Id, ORG2_PROJECT, {
      runName: ORG2_RUN_NAME,
      dashboardName: ORG2_DASHBOARD_NAME,
      tableViewName: ORG2_TABLE_VIEW_NAME,
      sweepId: ORG2_SWEEP_ID,
      memberEmail: ORG2_ONLY_EMAIL,
      logName: ORG2_METRIC,
      lenient: false,
    });
    org1 = await collectOrg(smokeCookie, org1Id, ORG1_PROJECT, {
      runName: 'a-bulk-run-011',
      memberEmail: SMOKE_EMAIL,
      logName: 'train/loss',
      lenient: true,
    });

    // The org2-only user must really be outside org 1, or check 1 proves nothing.
    const org2OnlyAuth = await ok('auth', 'query', {}, org2OnlyCookie);
    const org2OnlyOrgs = ((org2OnlyAuth?.allOrgs ?? []) as Array<{ slug: string }>).map((org) => org.slug);
    expect(org2OnlyOrgs, `${ORG2_ONLY_EMAIL} must be a member of ${ORG2_SLUG} only`).toEqual([ORG2_SLUG]);

    markers = [...STATIC_ORG2_MARKERS, org2.id, org2.runId, ...org2.runIds, org2.memberId, org2.invitationId, org2.apiKeyId];

    // REST identifiers are numeric; read them with org 2's own key.
    required(ORG2_API_KEY, 'TEST_ORG2_API_KEY in .env.test');
    required(ORG1_API_KEY, 'TEST_API_KEY in .env.test');
    const list = await rest('GET', '/api/runs/list', ORG2_API_KEY, { query: { projectName: ORG2_PROJECT } });
    if (list.status !== 200) {
      throw new Error(`GET /api/runs/list with org 2's key failed: HTTP ${list.status} ${list.text.slice(0, 300)}`);
    }
    const restRuns = (list.body?.runs ?? []) as Array<{ id: number; name: string; displayId: string | null }>;
    const restPrimary = required(restRuns.find((run) => run.name === ORG2_RUN_NAME), `run ${ORG2_RUN_NAME} via REST`);
    const dashboards = await rest('GET', '/api/dashboards/list', ORG2_API_KEY, { query: { projectName: ORG2_PROJECT } });
    if (dashboards.status !== 200) {
      throw new Error(`GET /api/dashboards/list with org 2's key failed: HTTP ${dashboards.status} ${dashboards.text.slice(0, 300)}`);
    }
    const restDashboard = required(
      ((dashboards.body?.dashboards ?? []) as Array<{ id: string; name: string }>).find(
        (view) => view.name === ORG2_DASHBOARD_NAME,
      ),
      `dashboard "${ORG2_DASHBOARD_NAME}" via REST`,
    );
    restIds = {
      projectName: ORG2_PROJECT,
      runId: restPrimary.id,
      runIds: restRuns.map((run) => run.id),
      displayId: required(restPrimary.displayId, `display id of ${ORG2_RUN_NAME}`),
      viewId: String(restDashboard.id),
      logName: ORG2_METRIC,
      foreignOrgId: org2.id,
      runSqids: org2.runIds,
      ownOrgId: org1.id,
    };

    // Baseline last, after every fixture read, so nothing below is "changed" by discovery.
    baseline = await org2Snapshot(smokeCookie, org2);
  }, 60_000);

  it('fixtures: the two organizations are distinct and org 2 owns the marker resources', () => {
    expect(org1.id).not.toBe(org2.id);
    expect(org2.runIds.length).toBeGreaterThanOrEqual(2);
    expect(baseline.run).toMatchObject({ name: ORG2_RUN_NAME, tags: ['org2-only-tag'], notes: 'org2-only-notes' });
  });

  // -------------------------------------------------------------------------
  // Check 1: membership
  // -------------------------------------------------------------------------
  describe("membership: an org2-only user × org 1's organizationId → UNAUTHORIZED", () => {
    for (const procedure of orgProcedures) {
      const excuse = MEMBERSHIP_ALLOWLIST[procedure.path];
      it.skipIf(excuse !== undefined)(`${procedure.path} (${procedure.type})`, async () => {
        const input = synthesizeInput(procedure.input, inputValuesFor(procedure.path, org1.id, org1));
        const response = await trpc(procedure.path, procedure.type, input, org2OnlyCookie);
        const detail = () =>
          `${procedure.path} (${procedure.type}) as ${ORG2_ONLY_EMAIL}\ninput: ${JSON.stringify(input)}\n` +
          `status: ${response.status} code: ${response.code}\nbody: ${response.text.slice(0, 800)}`;

        expect(response.status, `expected 401 for a non-member\n${detail()}`).toBe(401);
        expect(response.code, detail()).toBe('UNAUTHORIZED');
        expect(response.body?.result, `a non-member received a result\n${detail()}`).toBeUndefined();
        record(procedure.path, 'membership');
      });
    }
  });

  // -------------------------------------------------------------------------
  // Check 2: resource scoping (+ side effects for mutations)
  // -------------------------------------------------------------------------
  describe("resource scoping: a member of org 1 × org 1's organizationId × org 2's identifiers", () => {
    for (const procedure of orgProcedures) {
      const override = PROCEDURE_OVERRIDES[procedure.path];
      const excuse = SCOPING_ALLOWLIST[procedure.path];
      const expectation = override?.expect ?? defaultScopingExpectation(procedure.input);
      if (excuse === undefined && expectation === 'skip') {
        autoSkipped.set(procedure.path, 'input carries no resource identifier beyond organizationId; the membership check covers it');
      }

      it.skipIf(excuse !== undefined || expectation === 'skip')(
        `${procedure.path} (${procedure.type}) → ${expectation}`,
        async () => {
          const input = {
            ...synthesizeInput(procedure.input, inputValuesFor(procedure.path, org1.id, org2)),
            ...(override?.input?.(org2) ?? {}),
          };
          const response = await trpc(procedure.path, procedure.type, input, smokeCookie);
          const detail = () =>
            `${procedure.path} (${procedure.type}) as ${SMOKE_EMAIL} under org 1\ninput: ${JSON.stringify(input)}\n` +
            `status: ${response.status} code: ${response.code}\nbody: ${response.text.slice(0, 800)}`;

          if (response.status === 400 && !override?.acceptStatuses?.includes(400)) {
            throw new Error(
              `Synthesized input was rejected by the procedure's parser (BAD_REQUEST). That is a FALSE PASS, not ` +
                `isolation: nothing was checked. Add an entry for "${procedure.path}" to ` +
                `tests/tenant-isolation/overrides.ts that supplies a valid input.\n${detail()}`,
            );
          }
          if (response.status === 401) {
            throw new Error(`The smoke user must be a member of org 1; got UNAUTHORIZED.\n${detail()}`);
          }
          if (response.status >= 500) {
            throw new Error(`Server error on a cross-tenant request (the resolver should reject cleanly).\n${detail()}`);
          }

          const accepted = expectation === 'reject' ? [403, 404] : [200, 403, 404];
          for (const status of override?.acceptStatuses ?? []) {
            accepted.push(status);
          }
          expect(
            accepted,
            expectation === 'reject'
              ? `a required foreign identifier must be rejected with NOT_FOUND/FORBIDDEN, never answered\n${detail()}`
              : `unexpected status\n${detail()}`,
          ).toContain(response.status);
          if (response.status !== 200) {
            expect(response.body?.result, `an error status must not carry a result\n${detail()}`).toBeUndefined();
          }

          const leaked = leakedMarkers(response.text, markers);
          expect(leaked, `response carries org 2 data: ${JSON.stringify(leaked)}\n${detail()}`).toEqual([]);

          if (procedure.type === 'mutation') {
            expect(await org2Snapshot(smokeCookie, org2), `org 2 state changed after cross-tenant ${procedure.path}\n${detail()}`).toEqual(baseline);
          }
          record(procedure.path, 'scoping');
        },
      );
    }
  });

  // -------------------------------------------------------------------------
  // Check 3: REST with org 1's API key and org 2's identifiers
  // -------------------------------------------------------------------------
  describe("REST: org 1's API key × org 2's run id / display id / project / view id", () => {
    for (const check of REST_CHECKS) {
      const excuse = REST_ALLOWLIST[check.key];
      it.skipIf(excuse !== undefined)(`${check.key}${check.variant ? ` [${check.variant}]` : ''} → ${check.expect}`, async () => {
        const request = check.build(restIds);
        const response = await rest(request.method, request.path, ORG1_API_KEY, { query: request.query, body: request.body });
        const detail = () =>
          `${request.method} ${request.path}${request.query ? ` ?${new URLSearchParams(request.query)}` : ''}` +
          `${request.body ? `\nbody: ${JSON.stringify(request.body)}` : ''}\nstatus: ${response.status}\nresponse: ${response.text.slice(0, 800)}`;

        if (response.status === 400) {
          throw new Error(
            `Request was rejected as malformed (400) — a FALSE PASS. Fix the builder for "${check.key}" in ` +
              `tests/tenant-isolation/rest-endpoints.ts.\n${detail()}`,
          );
        }
        if (response.status === 401) {
          throw new Error(`org 1's API key was not accepted.\n${detail()}`);
        }
        if (response.status >= 500) {
          throw new Error(`Server error on a cross-tenant request.\n${detail()}`);
        }
        const accepted = check.expect === 'reject' ? [403, 404] : [200, 403, 404];
        expect(accepted, `unexpected status for a foreign identifier\n${detail()}`).toContain(response.status);

        const leaked = leakedMarkers(response.text, markers);
        expect(leaked, `response carries org 2 data: ${JSON.stringify(leaked)}\n${detail()}`).toEqual([]);

        if (check.mutation) {
          expect(await org2Snapshot(smokeCookie, org2), `org 2 state changed after ${check.key}\n${detail()}`).toEqual(baseline);
        }
        if (check.inventoried !== false) {
          exercisedRest.add(check.key);
        }
      });
    }
  });

  // -------------------------------------------------------------------------
  // Coverage guard
  // -------------------------------------------------------------------------
  describe('coverage guard', () => {
    it('docs/api-surface.json matches the live router (run `pnpm --filter @mlop/server inventory` if not)', async () => {
      const { collectTrpcProcedures } = await import('../lib/trpc-surface');
      const live = collectTrpcProcedures()
        .map((procedure) => `${procedure.path} ${procedure.type} ${procedure.auth}`)
        .sort();
      const documented = inventory.procedures
        .map((procedure) => `${procedure.path} ${procedure.type} ${procedure.auth}`)
        .sort();
      expect(documented, 'the inventory this suite generates from has drifted from the router').toEqual(live);
    });

    it('every session+org procedure was exercised by both checks or is allowlisted with a reason', () => {
      const report = auditCoverage({
        procedures: inventory.procedures,
        recorded,
        autoSkipped,
        membershipAllowlist: MEMBERSHIP_ALLOWLIST,
        scopingAllowlist: SCOPING_ALLOWLIST,
        overrides: PROCEDURE_OVERRIDES,
      });
      expect(report.missing.map((gap) => `${gap.path} (${gap.check})`), describeGaps(report)).toEqual([]);
      expect(report.stale, describeGaps(report)).toEqual([]);
    });

    it('every REST endpoint in the inventory was exercised or is allowlisted with a reason', () => {
      const report = auditRestCoverage(inventory.rest, exercisedRest, REST_ALLOWLIST);
      expect(report.missing, describeGaps(report)).toEqual([]);
      expect(report.stale, describeGaps(report)).toEqual([]);
    });

    it('prints the coverage summary', () => {
      const membership = [...recorded.values()].filter((set) => set.has('membership')).length;
      const scoping = [...recorded.values()].filter((set) => set.has('scoping')).length;
      console.log(
        `   tenant-isolation: ${orgProcedures.length} org-scoped procedures — membership ${membership}, ` +
          `scoping ${scoping}, auto-skipped ${autoSkipped.size}, allowlisted ${Object.keys(MEMBERSHIP_ALLOWLIST).length + Object.keys(SCOPING_ALLOWLIST).length}, ` +
          `overrides ${Object.keys(PROCEDURE_OVERRIDES).length}; REST ${exercisedRest.size}/${inventory.rest.length} endpoints, ` +
          `allowlisted ${Object.keys(REST_ALLOWLIST).length}`,
      );
    });
  });
});
