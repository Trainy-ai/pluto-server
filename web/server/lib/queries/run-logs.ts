/**
 * Shared query function for fetching run console logs from ClickHouse.
 * Used by both tRPC procedures and OpenAPI endpoints.
 */

import type { clickhouse } from "../clickhouse";

export interface QueryRunLogsParams {
  organizationId: string;
  projectName: string;
  runId: number;
  logType?: string;
  limit?: number;
  offset?: number;
}

export interface RunLogEntry {
  logType: string;
  message: string;
  time: string;
  lineNumber: number;
  step: number | null;
}

export interface QueryRunLogsResult {
  logs: RunLogEntry[];
  total: number;
}

/**
 * Query console logs from a run.
 * Returns log entries with optional filtering by log type and pagination.
 */
export async function queryRunLogs(
  ch: typeof clickhouse,
  params: QueryRunLogsParams
): Promise<QueryRunLogsResult> {
  const {
    organizationId,
    projectName,
    runId,
    logType,
    limit = 1000,
    offset = 0,
  } = params;

  // Build query with optional log type filter
  let query = `
    SELECT time, logType, lineNumber, message, step
    FROM mlop_logs
    WHERE tenantId = {tenantId: String}
    AND projectName = {projectName: String}
    AND runId = {runId: UInt64}
  `;

  const queryParams: Record<string, unknown> = {
    tenantId: organizationId,
    projectName,
    runId,
  };

  if (logType) {
    query += ` AND logType = {logType: String}`;
    queryParams.logType = logType;
  }

  query += ` ORDER BY lineNumber ASC LIMIT {limit: UInt32} OFFSET {offset: UInt32}`;
  queryParams.limit = limit;
  queryParams.offset = offset;

  // Get count query
  let countQuery = `
    SELECT count() as total
    FROM mlop_logs
    WHERE tenantId = {tenantId: String}
    AND projectName = {projectName: String}
    AND runId = {runId: UInt64}
  `;
  if (logType) {
    countQuery += ` AND logType = {logType: String}`;
  }

  const [logsResult, countResult] = await Promise.all([
    ch.query(query, queryParams),
    ch.query(countQuery, queryParams),
  ]);

  const logs = (await logsResult.json()) as RunLogEntry[];
  const countData = (await countResult.json()) as { total: string }[];
  const total = parseInt(countData[0]?.total ?? "0", 10);

  return { logs, total };
}

/**
 * Query all console logs from a run (with safety limit).
 * Used by tRPC procedure for frontend display.
 * Note: Limited to 100,000 lines to prevent memory exhaustion on large runs.
 */
export async function queryAllRunLogs(
  ch: typeof clickhouse,
  params: Omit<QueryRunLogsParams, "limit" | "offset">
): Promise<RunLogEntry[]> {
  const { organizationId, projectName, runId, logType } = params;

  // Safety limit to prevent memory exhaustion - ML runs can have millions of log lines
  const MAX_LOGS = 100000;

  let query = `
    SELECT time, logType, lineNumber, message, step
    FROM mlop_logs
    WHERE tenantId = {tenantId: String}
    AND projectName = {projectName: String}
    AND runId = {runId: UInt64}
  `;

  const queryParams: Record<string, unknown> = {
    tenantId: organizationId,
    projectName,
    runId,
  };

  if (logType) {
    query += ` AND logType = {logType: String}`;
    queryParams.logType = logType;
  }

  query += ` ORDER BY lineNumber ASC LIMIT {maxLogs: UInt32}`;
  queryParams.maxLogs = MAX_LOGS;

  const result = await ch.query(query, queryParams);
  return (await result.json()) as RunLogEntry[];
}
