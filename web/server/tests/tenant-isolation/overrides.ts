/**
 * Hand-written adjustments for procedures the generic synthesizer cannot
 * serve on its own. Every entry says why. Keep this list short: an override
 * is a hole in the generated coverage, so prefer fixing the synthesizer when
 * a pattern recurs.
 *
 * The suite fails (does not skip) when a synthesized input is rejected with
 * BAD_REQUEST, and points the author here.
 */
import type { OrgIdentifiers } from './identifiers';
import type { ScopingExpectation } from './synthesize-input';

export interface ProcedureOverride {
  reason: string;
  /**
   * Fields merged over the synthesized input for the resource-scoping check.
   * `foreign` is the other tenant's identifier set.
   */
  input?: (foreign: OrgIdentifiers) => Record<string, unknown>;
  /** Replace the schema-derived expectation (see `defaultScopingExpectation`). */
  expect?: Exclude<ScopingExpectation, 'skip'>;
  /**
   * Extra HTTP statuses the scoping check accepts as a rejection. Use only for
   * a deliberate, documented refusal that happens to use a status the default
   * policy reads as "synthesizer produced invalid input" (400).
   */
  acceptStatuses?: number[];
}

const DIRECT_DECODE =
  'Decodes the SQIDs itself and scopes the query by organizationId (Postgres) or tenantId (ClickHouse) rather than going through resolveRunIds, so foreign ids fall out of the result set instead of raising NOT_FOUND; the body is checked for org2 markers.';

const COERCED_VIEW_ID =
  'viewId is declared with z.coerce.string(), which zod-to-json-schema publishes as optional; the procedure still requires it, so a foreign id must be rejected, not answered.';

export const PROCEDURE_OVERRIDES: Record<string, ProcedureOverride> = {
  'dashboardViews.get': { expect: 'reject', reason: COERCED_VIEW_ID },
  'dashboardViews.delete': { expect: 'reject', reason: COERCED_VIEW_ID },
  'dashboardViews.update': { expect: 'reject', reason: COERCED_VIEW_ID },
  'dashboardViews.getVersion': { expect: 'reject', reason: COERCED_VIEW_ID },
  'dashboardViews.listVersions': { expect: 'reject', reason: COERCED_VIEW_ID },
  'dashboardViews.restoreVersion': { expect: 'reject', reason: COERCED_VIEW_ID },
  'runs.getByIds': {
    expect: 'no-leak',
    reason:
      'resolveRunIdsResilient drops ids the org does not own instead of throwing, so the correct answer to foreign ids is an empty 200; the body is checked for org2 markers.',
  },
  'runs.delete': {
    expect: 'no-leak',
    reason:
      'resolveRunIdsResilient drops foreign ids; deletes nothing (the org2 snapshot check proves it) and returns 200.',
  },
  'runs.data.filesBatch': {
    expect: 'no-leak',
    reason: 'resolveRunIdsResilient drops foreign ids; returns an empty batch.',
  },
  'runs.data.histogramBatch': {
    expect: 'no-leak',
    reason: 'resolveRunIdsResilient drops foreign ids; returns an empty batch.',
  },
  'runs.data.barsDataBatch': {
    expect: 'no-leak',
    reason: 'resolveRunIdsResilient drops foreign ids; returns an empty batch.',
  },
  'runs.getFieldValues': { expect: 'no-leak', reason: DIRECT_DECODE },
  'runs.getLogsByRunIds': { expect: 'no-leak', reason: DIRECT_DECODE },
  'runs.customChartPanels': { expect: 'no-leak', reason: DIRECT_DECODE },
  'runs.metricBestSteps': { expect: 'no-leak', reason: DIRECT_DECODE },
  'runs.metricSummaries': { expect: 'no-leak', reason: DIRECT_DECODE },
  'runs.runIdsByLogName': { expect: 'no-leak', reason: DIRECT_DECODE },
  'sweeps.get': {
    expect: 'no-leak',
    reason:
      'A sweep is addressed by (project, tag); a project name that does not exist in the requesting org returns null rather than NOT_FOUND.',
  },
  'organization.notifications.read': {
    expect: 'no-leak',
    reason:
      'updateMany scoped by organizationId is a no-op for foreign ids and returns 200; the org2 snapshot (unread count) proves nothing was marked read.',
  },
  'organization.transferOwnership': {
    acceptStatuses: [400],
    reason:
      'Rejects with BAD_REQUEST when newOwnerId is not an ADMIN of the org in the request. That refusal IS the scoping guard (the member lookup is org-scoped), not a synthesizer failure.',
  },
  'runs.data.graphMultiMetricBatchBucketedGrouped': {
    input: () => ({ groupBy: ['system:status'] }),
    reason: 'groupBy entries follow the `<kind>:<key>` grammar in lib/group-field.ts, which a plain string does not satisfy.',
  },
  'runs.distinctGroupValues': {
    input: () => ({ field: 'system:status' }),
    reason: '`field` follows the `<kind>:<key>` grammar in lib/group-field.ts.',
  },
  'runs.data.fileUrl': {
    input: () => ({ fileName: 'org2-only-file.png' }),
    reason: 'fileName is free text; a name that looks like a file keeps the request realistic (ownership is decided on runId before the name is read).',
  },
};
