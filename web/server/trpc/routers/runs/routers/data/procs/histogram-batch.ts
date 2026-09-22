import { protectedOrgProcedure } from "../../../../../../lib/trpc";
import { resolveRunIdsResilient } from "../../../../../../lib/resolve-run-id";
import { withBatchCache } from "../../../../../../lib/cache";
import type { clickhouse } from "../../../../../../lib/clickhouse";
import {
  histogramDataRow,
  histogramBatchInput,
  type HistogramDataRow,
  type HistogramBatchResult,
} from "./histogram.schema";
import { resolveLineageChain, type LineageSegment } from "./lineage-helpers";

interface RawRow {
  runId: number | string;
  total: number | string;
}

// Batched numeric histogram: ONE ClickHouse query for all selected runs instead
// of the per-run fan-out (use-normalized-histogram fired runs.data.histogram
// once per run). Window functions PARTITION BY runId so the per-run step-cap
// stride is identical to the single-run proc. Result keyed by encoded runId.
//
// Additive & backward-compatible: the single-run `histogram` proc is unchanged,
// so older frontends keep working. Mirrors barsDataBatch.
//
// `includeLineage` (the Experiments view) stitches a forked run's ancestors in
// front of it, each up to the step its child forked at — the same segments the
// line charts read. Runs with no ancestors stay in the one batched query; each
// forked run gets its own query whose rows are relabelled with its id, so the
// step cap strides over the whole stitched history.
export const histogramBatchProcedure = protectedOrgProcedure
  .input(histogramBatchInput)
  .query(async ({ ctx, input }) => {
    const { runIds: encodedRunIds, projectName, organizationId, logName, includeLineage } =
      input;
    // 0 = no cap (return all steps) — matches the single-run histogram default.
    const stepCap = input.stepCap ?? 0;

    // Resolve resiliently: a deleted/unauthorized run is skipped, not fatal to
    // the whole batch (one bad id must not 500 the widget for every other run).
    const resolved = await resolveRunIdsResilient(
      ctx.prisma,
      encodedRunIds,
      organizationId,
      projectName,
    );
    const numericToEncoded = new Map<number, string>();
    for (const { enc, num } of resolved) numericToEncoded.set(num, enc);
    const numericRunIds = Array.from(numericToEncoded.keys()).sort((a, b) => a - b);

    // Every requested run was invalid/unauthorized — nothing to query.
    if (numericRunIds.length === 0) return {};

    const stitched = new Map<number, LineageSegment[]>();
    if (includeLineage) {
      await Promise.all(
        numericRunIds.map(async (runId) => {
          const segments = await resolveLineageChain(ctx.prisma, runId, organizationId);
          if (segments.length > 1) stitched.set(runId, segments);
        }),
      );
    }
    const plainRunIds = numericRunIds.filter((id) => !stitched.has(id));

    return withBatchCache<HistogramBatchResult>(
      ctx,
      "histogram-batch-v1",
      {
        organizationId,
        projectName,
        runIds: numericRunIds,
        logName,
        stepCap,
        // Absent unless something is stitched, so unforked selections keep
        // the pre-lineage key. Carries the segments themselves, so a
        // merge/unmerge is an immediate miss.
        lineage: stitched.size > 0 ? lineageCacheKey(stitched) : undefined,
      },
      async () => {
        const baseParams = { tenantId: organizationId, projectName, logName, stepCap };
        const queries: Promise<RawRow[]>[] = [];

        if (plainRunIds.length > 0) {
          queries.push(
            queryHistogramRows(
              ctx.clickhouse,
              `
                SELECT runId, logName, time, step, data
                FROM mlop_data
                WHERE tenantId = {tenantId: String}
                  AND projectName = {projectName: String}
                  AND runId IN ({runIds: Array(UInt64)})
                  AND logName = {logName: String}
                  AND dataType ILIKE 'histogram'
              `,
              { ...baseParams, runIds: plainRunIds },
            ),
          );
        }

        for (const [runId, segments] of stitched) {
          const { source, params } = lineageHistogramSource(runId, segments);
          queries.push(queryHistogramRows(ctx.clickhouse, source, { ...baseParams, ...params }));
        }

        const raw = (await Promise.all(queries)).flat();

        // Group rows by numeric runId, then parse each run with the same row
        // schema as the single-run proc (which strips the extra runId/total).
        const byRun = new Map<number, RawRow[]>();
        for (const r of raw) {
          const rid = Number(r.runId);
          const arr = byRun.get(rid);
          if (arr) arr.push(r);
          else byRun.set(rid, [r]);
        }

        const result: HistogramBatchResult = {};
        for (const [numericRunId, encoded] of numericToEncoded) {
          const runRows = byRun.get(numericRunId);
          if (!runRows || runRows.length === 0) continue;
          const totalSteps = Number(runRows[0].total);
          const rows: HistogramDataRow[] = runRows.map((row) =>
            histogramDataRow.parse(row),
          );
          const truncated = stepCap !== 0 && rows.length < totalSteps;
          result[encoded] = { rows, truncated, totalSteps };
        }

        return result;
      },
    );
  });

/**
 * Row source for one forked run: each lineage segment's histogram rows,
 * bounded to the steps that segment owns and relabelled with the requested
 * run's id so the step cap and the response treat them as one run. Expects
 * the tenantId/projectName/logName params the caller binds. Exported for
 * unit tests.
 */
export function lineageHistogramSource(
  runId: number,
  segments: LineageSegment[],
): { source: string; params: Record<string, number> } {
  const params: Record<string, number> = { requestedRunId: runId };
  const parts = segments.map((seg, i) => {
    params[`runId_${i}`] = seg.runId;
    let stepFilter = "";
    if (seg.minStep > 0) {
      params[`stepMin_${i}`] = seg.minStep;
      stepFilter += ` AND step >= {stepMin_${i}: UInt64}`;
    }
    if (seg.maxStep != null) {
      params[`stepMax_${i}`] = seg.maxStep;
      stepFilter += ` AND step <= {stepMax_${i}: UInt64}`;
    }
    // The relabel must sit outside the filtering SELECT: ClickHouse resolves
    // a WHERE identifier to a same-scope SELECT alias before the column, so
    // `... AS runId ... WHERE runId = x` would compare the relabelled id.
    return `
      SELECT toUInt64({requestedRunId: UInt64}) AS runId, logName, time, step, data
      FROM (
        SELECT logName, time, step, data
        FROM mlop_data
        WHERE tenantId = {tenantId: String}
          AND projectName = {projectName: String}
          AND runId = {runId_${i}: UInt64}
          AND logName = {logName: String}
          AND dataType ILIKE 'histogram'${stepFilter}
      )
    `;
  });
  return { source: parts.join(" UNION ALL "), params };
}

// Applies the per-run step cap to `source` (rows of runId, logName, time,
// step, data). Keeps the first and last step and an even stride between.
export async function queryHistogramRows(
  ch: typeof clickhouse,
  source: string,
  params: Record<string, unknown>,
): Promise<RawRow[]> {
  const query = `
    SELECT runId, logName, time, step, histogramData, total
    FROM (
      SELECT
        runId,
        logName,
        time,
        step,
        data AS histogramData,
        row_number() OVER (PARTITION BY runId ORDER BY step ASC) AS rn,
        count() OVER (PARTITION BY runId) AS total
      FROM (${source})
    ) AS ranked
    WHERE
      {stepCap: UInt64} = 0
      OR total <= {stepCap: UInt64}
      OR rn = 1
      OR rn = total
      OR (rn - 1) % greatest(1, intDiv(total + {stepCap: UInt64} - 1, {stepCap: UInt64})) = 0
    ORDER BY runId, step ASC
  `;
  return (await ch.query(query, params).then((r) => r.json())) as RawRow[];
}

function lineageCacheKey(stitched: Map<number, LineageSegment[]>): string[] {
  return [...stitched]
    .map(
      ([runId, segments]) =>
        `${runId}=` +
        segments.map((s) => `${s.runId}@${s.minStep}-${s.maxStep ?? ""}`).join(","),
    )
    .sort();
}
