import { protectedOrgProcedure } from "../../../../../../lib/trpc";
import { resolveRunId } from "../../../../../../lib/resolve-run-id";
import { withBatchCache } from "../../../../../../lib/cache";
import {
  BARS_MIN_SUFFIXES,
  barsDataBatchInput,
  type BarsDataRow,
  type BarsDataBatchResult,
} from "./histogram.schema";

interface RawRow {
  runId: number | string;
  step: number | string;
  labels: string[];
  freq: Array<number | string>;
  total: number | string;
}

// Batched bars-data: ONE ClickHouse query for all selected runs, instead of
// the per-run fan-out the single-run `barsData` proc forces (N runs -> N
// round-trips + N cache entries + N query plans). The window functions are
// PARTITION BY runId so the step-cap stride is applied per run, identical to
// the single-run proc. Result is keyed by the encoded runId the caller passed.
//
// Additive and backward-compatible: the single-run `barsData` proc is left
// untouched, so older frontends that fan out per run keep working.
export const barsDataBatchProcedure = protectedOrgProcedure
  .input(barsDataBatchInput)
  .query(async ({ ctx, input }) => {
    const { runIds: encodedRunIds, projectName, organizationId, pathPrefix } = input;

    // Default cap: 500 sampled steps per run (matches the single-run proc).
    const stepCap = input.stepCap ?? 500;

    // Resolve every encoded runId -> numeric, keeping a numeric->encoded map so
    // results can be returned under the same sqid the caller passed in.
    const resolved = await Promise.all(
      encodedRunIds.map(async (enc) => ({
        enc,
        num: await resolveRunId(ctx.prisma, enc, organizationId, projectName),
      })),
    );
    const numericToEncoded = new Map<number, string>();
    for (const { enc, num } of resolved) numericToEncoded.set(num, enc);
    // Sorted for a stable cache key regardless of caller run order.
    const numericRunIds = Array.from(numericToEncoded.keys()).sort((a, b) => a - b);

    return withBatchCache<BarsDataBatchResult>(
      ctx,
      "bars-data-batch-v1",
      { organizationId, projectName, runIds: numericRunIds, pathPrefix, stepCap },
      async () => {
        const query = `
          WITH per_step AS (
            SELECT
              runId,
              step,
              substring(logName, length({prefix: String}) + 1) AS label,
              argMax(value, time) AS value
            FROM mlop_metrics
            WHERE tenantId = {tenantId: String}
              AND projectName = {projectName: String}
              AND runId IN ({runIds: Array(UInt64)})
              AND startsWith(logName, {prefix: String})
              AND substring(logName, length({prefix: String}) + 1) != ''
            GROUP BY runId, step, logName
          ),
          per_step_grouped AS (
            SELECT
              runId,
              step,
              groupArray(label) AS labels,
              groupArray(value) AS freq
            FROM per_step
            GROUP BY runId, step
          )
          SELECT runId, step, labels, freq, total
          FROM (
            SELECT
              runId,
              step,
              labels,
              freq,
              row_number() OVER (PARTITION BY runId ORDER BY step ASC) AS rn,
              count() OVER (PARTITION BY runId) AS total
            FROM per_step_grouped
          )
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
            prefix: pathPrefix,
            stepCap,
          })
          .then((r) => r.json())) as RawRow[];

        // Group rows by numeric runId, then process each run with the SAME
        // canonical-label + zero-fill logic as the single-run proc.
        const byRun = new Map<number, RawRow[]>();
        for (const r of raw) {
          const rid = Number(r.runId);
          const arr = byRun.get(rid);
          if (arr) arr.push(r);
          else byRun.set(rid, [r]);
        }

        const result: BarsDataBatchResult = {};
        for (const [numericRunId, encoded] of numericToEncoded) {
          const runRows = byRun.get(numericRunId);
          if (!runRows || runRows.length === 0) continue;

          // Canonical label order: max-value desc across this run.
          const labelMax = new Map<string, number>();
          for (const r of runRows) {
            for (let i = 0; i < r.labels.length; i++) {
              const v = Number(r.freq[i]);
              const cur = labelMax.get(r.labels[i]) ?? -Infinity;
              if (v > cur) labelMax.set(r.labels[i], v);
            }
          }
          // Per-run eligibility: skip (don't throw) under-threshold runs. In a
          // batch, one sparse run must not 400 the whole widget — the single-run
          // proc throws BAD_REQUEST, but the client filters empty/missing runs
          // anyway, so omitting is the right batch behavior.
          if (labelMax.size < BARS_MIN_SUFFIXES) continue;

          const canonicalLabels = Array.from(labelMax.entries())
            .sort((a, b) => (b[1] !== a[1] ? b[1] - a[1] : a[0].localeCompare(b[0])))
            .map(([label]) => label);
          const labelIndex = new Map<string, number>();
          canonicalLabels.forEach((label, idx) => labelIndex.set(label, idx));

          const totalSteps = Number(runRows[0].total);
          const rows: BarsDataRow[] = runRows.map((r) => {
            const freq = new Array<number>(canonicalLabels.length).fill(0);
            let maxFreq = 0;
            for (let i = 0; i < r.labels.length; i++) {
              const idx = labelIndex.get(r.labels[i]);
              if (idx === undefined) continue;
              const v = Number(r.freq[i]);
              freq[idx] = v;
              if (v > maxFreq) maxFreq = v;
            }
            return {
              step: Number(r.step),
              bars: {
                freq,
                labels: canonicalLabels,
                shape: "categorical" as const,
                type: "Histogram" as const,
                maxFreq,
              },
            };
          });

          result[encoded] = {
            rows,
            truncated: rows.length < totalSteps,
            totalSteps,
            canonicalLabels,
          };
        }

        return result;
      },
    );
  });
