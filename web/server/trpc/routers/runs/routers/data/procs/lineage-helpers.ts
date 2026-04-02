/**
 * Inlined lineage resolution helpers for graph procedures.
 * These are inlined rather than imported from lib/queries because
 * the external module gets tree-shaken out of the Next.js production bundle.
 */

import { queryRunMetricsBucketedByLogName } from "../../../../../../lib/queries";
import type { BucketedMetricDataPoint } from "../../../../../../lib/queries";
import { getLogGroupName } from "../../../../../../lib/utilts";

const MAX_LINEAGE_DEPTH = 10;

interface LineageSegment {
  runId: number;
  maxStep: number | null;
  minStep: number;
}

export async function resolveLineageChain(
  prisma: any,
  runId: number,
  organizationId: string,
): Promise<LineageSegment[]> {
  const chain: Array<{ id: number; forkedFromRunId: number | null; forkStep: number | null }> = [];
  let currentId: bigint | null = BigInt(runId);
  let depth = 0;

  while (currentId != null && depth < MAX_LINEAGE_DEPTH) {
    const run: { id: bigint; forkedFromRunId: bigint | null; forkStep: bigint | null } | null =
      await prisma.runs.findFirst({
        where: { id: currentId, organizationId },
        select: { id: true, forkedFromRunId: true, forkStep: true },
      });
    if (!run) break;

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

  const segments: LineageSegment[] = [];
  for (let i = 0; i < chain.length; i++) {
    const node = chain[i];
    const isLast = i === chain.length - 1;
    if (isLast) {
      const minStep = node.forkStep != null ? node.forkStep + 1 : 0;
      segments.push({ runId: node.id, maxStep: null, minStep });
    } else {
      const nextNode = chain[i + 1];
      const maxStep = nextNode.forkStep ?? 0;
      const minStep = node.forkStep != null ? node.forkStep + 1 : 0;
      segments.push({ runId: node.id, maxStep, minStep });
    }
  }

  return segments;
}

export async function queryLineageBucketed(
  ch: any,
  prisma: any,
  params: {
    organizationId: string;
    projectName: string;
    runId: number;
    logName: string;
    buckets?: number;
  },
): Promise<BucketedMetricDataPoint[]> {
  const { organizationId, projectName, runId, logName, buckets } = params;
  const segments = await resolveLineageChain(prisma, runId, organizationId);

  if (segments.length <= 1) {
    return queryRunMetricsBucketedByLogName(ch, {
      organizationId,
      projectName,
      runId,
      logName,
      buckets,
    });
  }

  const logGroup = getLogGroupName(logName) ?? "";
  const numBuckets = buckets ?? 1000;

  const queryParams: Record<string, unknown> = {
    tenantId: organizationId,
    projectName,
    logName,
    logGroup,
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
      argMin(c.time, c.step) AS time,
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

  for (const row of rows) {
    row.value = row.value ?? 0;
    row.minY = row.minY ?? 0;
    row.maxY = row.maxY ?? 0;
  }

  return rows;
}
