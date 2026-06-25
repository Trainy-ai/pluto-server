import { protectedOrgProcedure } from "../../../../../../lib/trpc";
import { resolveRunIdsResilient } from "../../../../../../lib/resolve-run-id";
import { withBatchCache } from "../../../../../../lib/cache";
import {
  histogramDataRow,
  histogramBatchInput,
  type HistogramDataRow,
  type HistogramBatchResult,
} from "./histogram.schema";

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
export const histogramBatchProcedure = protectedOrgProcedure
  .input(histogramBatchInput)
  .query(async ({ ctx, input }) => {
    const { runIds: encodedRunIds, projectName, organizationId, logName } = input;
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

    return withBatchCache<HistogramBatchResult>(
      ctx,
      "histogram-batch-v1",
      { organizationId, projectName, runIds: numericRunIds, logName, stepCap },
      async () => {
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
            FROM mlop_data
            WHERE tenantId = {tenantId: String}
              AND projectName = {projectName: String}
              AND runId IN ({runIds: Array(UInt64)})
              AND logName = {logName: String}
              AND dataType ILIKE 'histogram'
          ) AS ranked
          WHERE
            {stepCap: UInt64} = 0
            OR total <= {stepCap: UInt64}
            OR rn = 1
            OR rn = total
            OR (rn - 1) % greatest(1, intDiv(total + {stepCap: UInt64} - 1, {stepCap: UInt64})) = 0
          ORDER BY runId, step ASC
        `;

        const raw = (await ctx.clickhouse
          .query(query, {
            tenantId: organizationId,
            projectName,
            runIds: numericRunIds,
            logName,
            stepCap,
          })
          .then((r) => r.json())) as RawRow[];

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
