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
  caption: string | null;
  /**
   * Bounding boxes / mask references, JSON in wandb's shape. Declared because
   * the query selects it and the spread below returns it — this type backs the
   * public HTTP file endpoints, so an undeclared field here is a response body
   * that does not match its own contract.
   */
  annotations: string | null;
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
    SELECT fileName, fileType, fileSize, logName, logGroup, time, step, caption, annotations
    FROM mlop_files
    WHERE ${whereClause}
    ORDER BY step ASC, sampleIndex ASC, fileName ASC
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
    caption: string | null;
    // JSON in wandb's shape; parsed by the frontend, opaque here.
    annotations: string | null;
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
        caption: file.caption ?? null,
        annotations: file.annotations ?? null,
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
): Promise<
  {
    time: string;
    step: number;
    fileName: string;
    fileType: string;
    url: string;
    caption: string | null;
    annotations: string | null;
  }[]
> {
  const { organizationId, projectName, runId, logName } = params;
  const logGroup = getLogGroupName(logName);

  // Safety limit to prevent resource exhaustion - runs can have thousands of artifacts
  const MAX_FILES = 10000;

  const query = `
    SELECT time, step, fileName, fileType, caption, annotations
    FROM mlop_files
    WHERE tenantId = {tenantId: String}
    AND projectName = {projectName: String}
    AND runId = {runId: UInt64}
    AND logName = {logName: String}
    AND logGroup = {logGroup: String}
    -- sampleIndex (SDK-supplied list position) is the real order for
    -- multi-sample-per-step list logging; fileName is only a stable
    -- tiebreak for legacy rows where every sampleIndex defaults to 0.
    ORDER BY step ASC, sampleIndex ASC, fileName ASC
    LIMIT {maxFiles: UInt32}
  `;

  const result = await ch.query(
    query,
    {
      tenantId: organizationId,
      projectName,
      runId,
      logName,
      logGroup,
      maxFiles: MAX_FILES,
    },
    { label: "queryRunFilesByLogName" }
  );

  const files = (await result.json()) as {
    time: string;
    step: number;
    fileName: string;
    fileType: string;
    caption: string | null;
    annotations: string | null;
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
      return { ...file, caption: file.caption ?? null, annotations: file.annotations ?? null, url };
    })
  );

  return filesWithUrls;
}

/**
 * Lightweight metadata-only query for building a file browser tree.
 * Does NOT generate presigned URLs to avoid expensive parallel URL generation.
 */
export interface RunFileMetadata {
  fileName: string;
  fileType: string;
  fileSize: number;
  logName: string;
  logGroup: string;
  time: string;
  step: number;
  /** Present so the Files tab can show the same caption the run page does. */
  caption: string | null;
  /** Boxes / mask references, so the browser preview matches the run page. */
  annotations: string | null;
}

export async function queryRunFileTree(
  ch: typeof clickhouse,
  params: {
    organizationId: string;
    projectName: string;
    runId: number;
    limit?: number;
  }
): Promise<RunFileMetadata[]> {
  const { organizationId, projectName, runId, limit = 10000 } = params;

  const query = `
    SELECT fileName, fileType, fileSize, logName, logGroup, time, step, caption, annotations
    FROM mlop_files
    WHERE tenantId = {tenantId: String}
    AND projectName = {projectName: String}
    AND runId = {runId: UInt64}
    ORDER BY logName ASC, step ASC, sampleIndex ASC, fileName ASC
    LIMIT {limit: UInt32}
  `;

  const result = await ch.query(
    query,
    {
      tenantId: organizationId,
      projectName,
      runId,
      limit,
    },
    { label: "queryRunFileTree" }
  );

  return (await result.json()) as RunFileMetadata[];
}

/** One distinct `(logName, fileType)` pair a run logged. */
export interface RunFileLogType {
  logName: string;
  fileType: string;
}

/**
 * The distinct `(logName, fileType)` pairs of a run.
 *
 * The metrics views classify a file log by its files' EXTENSION (a `.json` may
 * be a Plotly figure, an `.html` an interactive report), and that is all they
 * need — not the file names, sizes, captions or per-image annotations
 * `queryRunFileTree` returns for up to 10,000 rows. A run with 3,000 annotated
 * images and one `training.log` has three distinct pairs at most.
 *
 * No `LIMIT`: the result is bounded by the number of distinct pairs, and
 * `DISTINCT` is evaluated in ClickHouse, so the full rows never cross the wire.
 */
export async function queryRunFileLogTypes(
  ch: typeof clickhouse,
  params: {
    organizationId: string;
    projectName: string;
    runId: number;
  }
): Promise<RunFileLogType[]> {
  const { organizationId, projectName, runId } = params;

  const query = `
    SELECT DISTINCT logName, fileType
    FROM mlop_files
    WHERE tenantId = {tenantId: String}
    AND projectName = {projectName: String}
    AND runId = {runId: UInt64}
    ORDER BY logName ASC, fileType ASC
  `;

  const result = await ch.query(
    query,
    {
      tenantId: organizationId,
      projectName,
      runId,
    },
    { label: "queryRunFileLogTypes" }
  );

  return (await result.json()) as RunFileLogType[];
}

/**
 * Generate a presigned URL for a single file.
 */
export async function getRunFileUrl(
  params: {
    organizationId: string;
    projectName: string;
    runId: number;
    logName: string;
    fileName: string;
  }
): Promise<string> {
  const { organizationId, projectName, runId, logName, fileName } = params;
  return getImageUrl(organizationId, projectName, runId, logName, fileName);
}
