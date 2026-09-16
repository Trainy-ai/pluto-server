/**
 * Procedures and endpoints deliberately excluded from a tenant-isolation
 * check, each with the reason. The coverage guard in
 * tests/tenant-isolation.test.ts fails for anything in the inventory that is
 * neither exercised nor listed here, so a new procedure must be covered — or
 * consciously excused — on the day it is added.
 *
 * `TODO(tenancy)` marks a suspected real gap that must be fixed in its own
 * PR; the entry keeps CI green only until then.
 */

/** tRPC procedures excused from the membership check (org2-only user × org1 id → 401). */
export const MEMBERSHIP_ALLOWLIST: Record<string, string> = {};

/**
 * tRPC procedures excused from the resource-scoping check (member of org1 ×
 * org1 id × org2 identifiers → 404/403, or an empty 200 with no org2 data).
 * Procedures whose input carries no identifier beyond `organizationId` are
 * skipped automatically and do not need an entry.
 */
export const SCOPING_ALLOWLIST: Record<string, string> = {};

/** REST endpoints (`METHOD /path` as printed in docs/api-surface.json) excused from the API-key loop. */
export const REST_ALLOWLIST: Record<string, string> = {
  'GET /api/runs/{runId}':
    'Pure SQID decode of the path parameter — returns the caller-supplied number back and reads no tenant data.',
  'GET /api/runs/auth/validate': 'Takes no resource identifier; reports on the bearer key itself.',
  'GET /api/runs/projects': "Takes no resource identifier; lists the bearer key's own organization.",
  'POST /api/runs/create':
    "Creates under the bearer key's own organization. The only foreign value it could carry is a project name, which would create a same-named project in the caller's org rather than touch the other tenant.",
};
