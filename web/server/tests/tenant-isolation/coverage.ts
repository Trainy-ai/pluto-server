/**
 * Coverage accounting for the tenant-isolation suite. Pure functions so the
 * guard itself can be unit-tested without a server (see
 * tests/tenant-isolation-guard.test.ts).
 */

export type CheckKind = 'membership' | 'scoping';

export interface InventoryProcedure {
  path: string;
  auth: string;
}

export interface CoverageInputs {
  procedures: InventoryProcedure[];
  /** check kinds each procedure actually completed (recorded by the tests as they pass) */
  recorded: ReadonlyMap<string, ReadonlySet<CheckKind>>;
  /** scoping checks the suite skipped automatically, with the reason */
  autoSkipped: ReadonlyMap<string, string>;
  membershipAllowlist: Record<string, string>;
  scopingAllowlist: Record<string, string>;
  overrides: Record<string, unknown>;
}

export interface CoverageGap {
  path: string;
  check: CheckKind;
}

export interface CoverageReport {
  /** org-scoped procedures that neither completed a check nor are excused from it */
  missing: CoverageGap[];
  /** allowlist / override entries that name a procedure the inventory no longer has */
  stale: string[];
}

export function auditCoverage(inputs: CoverageInputs): CoverageReport {
  const orgScoped = inputs.procedures.filter((procedure) => procedure.auth === 'session+org');
  const known = new Set(inputs.procedures.map((procedure) => procedure.path));
  const missing: CoverageGap[] = [];

  for (const procedure of orgScoped) {
    const done = inputs.recorded.get(procedure.path) ?? new Set<CheckKind>();
    if (!done.has('membership') && !(procedure.path in inputs.membershipAllowlist)) {
      missing.push({ path: procedure.path, check: 'membership' });
    }
    if (
      !done.has('scoping') &&
      !(procedure.path in inputs.scopingAllowlist) &&
      !inputs.autoSkipped.has(procedure.path)
    ) {
      missing.push({ path: procedure.path, check: 'scoping' });
    }
  }

  const stale = [
    ...Object.keys(inputs.membershipAllowlist),
    ...Object.keys(inputs.scopingAllowlist),
    ...Object.keys(inputs.overrides),
  ].filter((path) => !known.has(path));

  return { missing, stale: [...new Set(stale)] };
}

export interface RestEndpoint {
  method: string;
  path: string;
}

export function restKey(endpoint: RestEndpoint): string {
  return `${endpoint.method.toUpperCase()} ${endpoint.path}`;
}

export interface RestCoverageReport {
  missing: string[];
  stale: string[];
}

export function auditRestCoverage(
  endpoints: RestEndpoint[],
  exercised: ReadonlySet<string>,
  allowlist: Record<string, string>,
): RestCoverageReport {
  const known = new Set(endpoints.map(restKey));
  const missing = [...known].filter((key) => !exercised.has(key) && !(key in allowlist));
  const stale = Object.keys(allowlist).filter((key) => !known.has(key));
  return { missing, stale };
}

export function describeGaps(report: CoverageReport | RestCoverageReport): string {
  const lines: string[] = [];
  const missing: Array<string | CoverageGap> = report.missing;
  if (missing.length > 0) {
    lines.push('Not covered by any tenant-isolation check and not allowlisted:');
    for (const gap of missing) {
      lines.push(typeof gap === 'string' ? `  - ${gap}` : `  - ${gap.path} (${gap.check})`);
    }
    lines.push(
      'Every org-scoped procedure/endpoint must be exercised by tests/tenant-isolation.test.ts or excused in tests/tenant-isolation/allowlist.ts with a reason.',
    );
  }
  if (report.stale.length > 0) {
    lines.push('Allowlist/override entries that no longer match anything in docs/api-surface.json:');
    for (const key of report.stale) {
      lines.push(`  - ${key}`);
    }
  }
  return lines.join('\n');
}
