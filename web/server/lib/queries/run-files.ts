/**
 * Shared query function for fetching run files from ClickHouse.
 * Used by both tRPC procedures and OpenAPI endpoints.
 */

import type { clickhouse } from "../clickhouse";
import { getImageUrl } from "../s3";
import { getLogGroupName } from "../utilts";

export interface QueryRunFilesParams {
  organizationId: string;
  projectName: string;
  runId: number;
  logName?: string;
  logGroup?: string;
  limit?: number;
}

export interface RunFileEntry {
  fileName: string;
  fileType: string;
  fileSize: number;
  logName: string;
  logGroup: string;
  time: string;
  step: number;
  url: string;
}

/**
 * Query files from a run with presigned URLs.
 * Supports filtering by logName and/or logGroup.
 */
export async function queryRunFiles(
  ch: typeof clickhouse,
  params: QueryRunFilesParams
): Promise<RunFileEntry[]> {
  const {
    organizationId,
    projectName,
    runId,
    logName,
    logGroup,
    limit = 1000,
  } = params;

  // Build where clause
  let whereClause = `
    tenantId = {tenantId: String}
    AND projectName = {projectName: String}
    AND runId = {runId: UInt64}
  `;

  const queryParams: Record<string, unknown> = {
    tenantId: organizationId,
    projectName,
    runId,
  };

  if (logName) {
    whereClause += ` AND logName = {logName: String}`;
    queryParams.logName = logName;
  }

  if (logGroup) {
    whereClause += ` AND logGroup = {logGroup: String}`;
    queryParams.logGroup = logGroup;
  }

  const query = `
    SELECT fileName, fileType, fileSize, logName, logGroup, time, step
    FROM mlop_files
    WHERE ${whereClause}
    ORDER BY step ASC
    LIMIT {limit: UInt32}
  `;
  queryParams.limit = limit;

  const result = await ch.query(query, queryParams);
  const files = (await result.json()) as {
    fileName: string;
    fileType: string;
    fileSize: number;
    logName: string;
    logGroup: string;
    time: string;
    step: number;
  }[];

  // Generate presigned URLs for all files in parallel
  const filesWithUrls = await Promise.all(
    files.map(async (file) => {
      const url = await getImageUrl(
        organizationId,
        projectName,
        runId,
        file.logName,
        file.fileName
      );
      return {
        ...file,
        fileSize: file.fileSize ?? 0, // Ensure fileSize is always a number
        url,
      };
    })
  );

  return filesWithUrls;
}

/**
 * Query files for a specific logName (used by tRPC files procedure).
 * Returns files with presigned URLs.
 * Note: Limited to 10,000 files to prevent resource exhaustion from parallel URL generation.
 */
export async function queryRunFilesByLogName(
  ch: typeof clickhouse,
  params: {
    organizationId: string;
    projectName: string;
    runId: number;
    logName: string;
  }
): Promise<{ time: string; step: number; fileName: string; fileType: string; url: string }[]> {
  const { organizationId, projectName, runId, logName } = params;
  const logGroup = getLogGroupName(logName);

  // Safety limit to prevent resource exhaustion - runs can have thousands of artifacts
  const MAX_FILES = 10000;

  const query = `
    SELECT time, step, fileName, fileType
    FROM mlop_files
    WHERE tenantId = {tenantId: String}
    AND projectName = {projectName: String}
    AND runId = {runId: UInt64}
    AND logName = {logName: String}
    AND logGroup = {logGroup: String}
    ORDER BY step ASC
    LIMIT {maxFiles: UInt32}
  `;

  const result = await ch.query(query, {
    tenantId: organizationId,
    projectName,
    runId,
    logName,
    logGroup,
    maxFiles: MAX_FILES,
  });

  const files = (await result.json()) as {
    time: string;
    step: number;
    fileName: string;
    fileType: string;
  }[];

  // Generate presigned URLs for all files in parallel
  const filesWithUrls = await Promise.all(
    files.map(async (file) => {
      const url = await getImageUrl(
        organizationId,
        projectName,
        runId,
        logName,
        file.fileName
      );
      return { ...file, url };
    })
  );

  return filesWithUrls;
}
