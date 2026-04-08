/**
 * Lineage-aware metrics query for forked runs.
 * Queries metrics across the full lineage chain (ancestors + current run)
 * and stitches them together so charts show the complete training history.
 */

import type { PrismaClient } from "@prisma/client";
import type { clickhouse } from "../clickhouse";
import {
  queryRunMetricsBucketedByLogName,
  type BucketedMetricDataPoint,
  type DownsamplingAlgorithm,
} from "./run-metrics";
import { getLogGroupName } from "../utilts";

/** Maximum lineage depth to prevent runaway queries */
const MAX_LINEAGE_DEPTH = 10;

/** A segment of the lineage chain: which run to query and up to which step */
interface LineageSegment {
  runId: number;
  maxStep: number | null; // null = no upper bound (the leaf/current run)
  minStep: number;        // 0 for root, forkStep+1 for intermediate
}

/**
 * Resolve the full lineage chain for a run, from root ancestor to the run itself.
 * Returns an ordered list of segments, each describing which run to query
 * and what step range to use.
 */
export async function resolveLineageChain(
  prisma: PrismaClient,
  runId: number,
  organizationId: string
): Promise<LineageSegment[]> {
  // Walk up the tree to collect ancestors
  const chain: Array<{
    id: number;
    forkedFromRunId: number | null;
    forkStep: number | null;
  }> = [];

  let currentId: bigint | null = BigInt(runId);
  let depth = 0;

  while (currentId != null && depth < MAX_LINEAGE_DEPTH) {
    const run: {
      id: bigint;
      forkedFromRunId: bigint | null;
      forkStep: bigint | null;
    } | null = await prisma.runs.findFirst({
      where: { id: currentId, organizationId },
      select: {
        id: true,
        forkedFromRunId: true,
        forkStep: true,
      },
    });

    if (!run) {
      break;
    }

    chain.unshift({
      id: Number(run.id),
      forkedFromRunId: run.forkedFromRunId != null ? Number(run.forkedFromRunId) : null,
      forkStep: run.forkStep != null ? Number(run.forkStep) : null,
    });

    currentId = run.forkedFromRunId;
    depth++;
  }

  if (chain.length === 0) {
    return [{ runId, maxStep: null, minStep: 0 }];
  }

  // Build segments: each ancestor contributes data from its own start
  // up to the fork step of the child that forked from it
  const segments: LineageSegment[] = [];

  for (let i = 0; i < chain.length; i++) {
    const node = chain[i];
    const isLast = i === chain.length - 1;

    if (isLast) {
      // Current run: all data from forkStep+1 onwards (or all data if root)
      const minStep = node.forkStep != null ? node.forkStep + 1 : 0;
      segments.push({
        runId: node.id,
        maxStep: null,
        minStep,
      });
    } else {
      // Ancestor: data up to the next node's forkStep
      const nextNode = chain[i + 1];
      const maxStep = nextNode.forkStep ?? 0;
      // For the root ancestor, start from 0; for intermediate ancestors,
      // start from their own forkStep+1
      const minStep = node.forkStep != null ? node.forkStep + 1 : 0;
      segments.push({
        runId: node.id,
        maxStep,
        minStep,
      });
    }
  }

  return segments;
}

/**
 * Query bucketed metrics across the full lineage chain for a single logName.
 * Returns combined data points from all ancestors + the current run.
 */
export async function queryLineageMetricsBucketedByLogName(
  ch: typeof clickhouse,
  prisma: PrismaClient,
  params: {
    organizationId: string;
    projectName: string;
    runId: number;
    logName: string;
    buckets?: number;
    preview?: boolean;
    algorithm?: DownsamplingAlgorithm;
    dedup?: boolean;
  }
): Promise<BucketedMetricDataPoint[]> {
  const { organizationId, projectName, runId, logName, buckets, preview, algorithm, dedup } =
    params;

  const segments = await resolveLineageChain(prisma, runId, organizationId);

  if (segments.length <= 1) {
    // No lineage — use the standard single-run query
    return queryRunMetricsBucketedByLogName(ch, {
      organizationId,
      projectName,
      runId,
      logName,
      buckets,
      preview,
      algorithm,
      dedup,
    });
  }

  // Build a single UNION ALL query across all lineage segments
  const logGroup = getLogGroupName(logName);
  const numBuckets = buckets ?? (preview ? 200 : 1000);

  const queryParams: Record<string, unknown> = {
    tenantId: organizationId,
    projectName,
    logName,
    logGroup: logGroup ?? "",
    numBuckets,
  };

  const unionParts: string[] = [];

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    queryParams[`runId_${i}`] = seg.runId;

    let stepFilter = "";
    if (seg.minStep > 0) {
      queryParams[`stepMin_${i}`] = seg.minStep;
      stepFilter += ` AND step >= {stepMin_${i}: UInt64}`;
    }
    if (seg.maxStep != null) {
      queryParams[`stepMax_${i}`] = seg.maxStep;
      stepFilter += ` AND step <= {stepMax_${i}: UInt64}`;
    }

    if (dedup) {
      unionParts.push(`
        SELECT step, argMax(value, time) AS value, max(time) AS ts
        FROM mlop_metrics
        WHERE tenantId = {tenantId: String}
          AND projectName = {projectName: String}
          AND runId = {runId_${i}: UInt64}
          AND logName = {logName: String}
          AND logGroup = {logGroup: String}
          ${stepFilter}
        GROUP BY step
      `);
    } else {
      unionParts.push(`
        SELECT step, time, value
        FROM mlop_metrics
        WHERE tenantId = {tenantId: String}
          AND projectName = {projectName: String}
          AND runId = {runId_${i}: UInt64}
          AND logName = {logName: String}
          AND logGroup = {logGroup: String}
          ${stepFilter}
      `);
    }
  }

  const timeAgg = dedup ? "min(c.ts)" : "argMin(c.time, c.step)";

  const query = `
    WITH
      combined AS (${unionParts.join(" UNION ALL ")}),
      bounds AS (
        SELECT min(step) AS minStep, max(step) AS maxStep
        FROM combined
      )
    SELECT
      intDiv(c.step - b.minStep, greatest(toUInt64(1), intDiv(b.maxStep - b.minStep + 1, toUInt64({numBuckets: UInt32})))) AS bucket,
      min(c.step) AS step,
      ${timeAgg} AS time,
      avg(c.value) AS value,
      min(c.value) AS minY,
      max(c.value) AS maxY,
      toUInt64(count()) AS count
    FROM combined c
    CROSS JOIN bounds b
    GROUP BY bucket
    ORDER BY bucket ASC
  `;

  const result = await ch.query(query, queryParams);
  const rows = (await result.json()) as BucketedMetricDataPoint[];

  // Sanitize null values from NaN/Inf
  for (const row of rows) {
    row.value = row.value ?? 0;
    row.minY = row.minY ?? 0;
    row.maxY = row.maxY ?? 0;
  }

  return rows;
}
