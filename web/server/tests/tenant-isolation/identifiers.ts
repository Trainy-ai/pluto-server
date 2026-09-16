/**
 * The identifiers one organization's fixtures expose, and how they map onto
 * procedure input keys.
 *
 * `viewId` is the one key whose meaning depends on the procedure: dashboard
 * procedures read it as a DashboardView id and run-table procedures as a
 * RunTableView id, so the mapping is done per procedure path rather than
 * per key.
 */

export interface OrgIdentifiers {
  id: string;
  projectName: string;
  /** SQID of the primary fixture run */
  runId: string;
  /** SQIDs of every fixture run in the project (≥ 2, `runs.merge` needs two) */
  runIds: string[];
  dashboardViewId: string;
  runTableViewId: string;
  sweepId: string;
  memberId: string;
  invitationId: string;
  apiKeyId: string;
  notificationIds: number[];
  /** a user id that is a member of the org — `transferOwnership.newOwnerId` */
  newOwnerId: string;
  /** a metric logged under the primary run */
  logName: string;
}

/**
 * Values the synthesizer substitutes into a procedure's input, keyed by input
 * property name. `organizationId` is passed separately because the two checks
 * pair it with different resource sets (the caller's own org with the other
 * tenant's rows, or vice versa).
 */
export function inputValuesFor(
  procedurePath: string,
  organizationId: string,
  ids: OrgIdentifiers,
): Record<string, unknown> {
  const viewId = procedurePath.startsWith('runTableViews.')
    ? ids.runTableViewId
    : ids.dashboardViewId;
  return {
    organizationId,
    projectName: ids.projectName,
    runId: ids.runId,
    runIds: ids.runIds,
    viewId,
    sweepId: ids.sweepId,
    memberId: ids.memberId,
    invitationId: ids.invitationId,
    apiKeyId: ids.apiKeyId,
    notificationIds: ids.notificationIds,
    newOwnerId: ids.newOwnerId,
    logName: ids.logName,
    logNames: [ids.logName],
    xMetric: ids.logName,
  };
}
