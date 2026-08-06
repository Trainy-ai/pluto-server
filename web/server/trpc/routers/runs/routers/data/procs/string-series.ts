import { protectedOrgProcedure } from "../../../../../../lib/trpc";
import { resolveRunId } from "../../../../../../lib/resolve-run-id";
import { withCache } from "../../../../../../lib/cache";
import {
  STRING_SERIES_DATA_TYPE,
  stringSeriesInput,
  type StringSeriesQueryResult,
} from "./string-series.schema";

interface RawRow {
  step: number | string;
  time: string;
  value: string;
  total: number | string;
}

/**
 * Non-numeric (string) time series — e.g. `log("phase", "warmup")`.
 *
 * Reads raw (step, value) pairs from `mlop_data` and returns them as-is.
 * `StringSeriesChart` maps each value to its index in `canonicalLabels` to draw
 * the staircase — a trivial client-side lookup. Encoding that per-step vector
 * here instead would put steps x labels mostly-zero numbers on the wire in
 * place of one short string per step.
 *
 * Step sampling mirrors barsData/histogram: an evenly-strided sample capped at
 * `stepCap`, always keeping the first and last step so the timeline's endpoints
 * are honest.
 */
export const stringSeriesProcedure = protectedOrgProcedure
  .input(stringSeriesInput)
  .query(async ({ ctx, input }) => {
    const { runId: encodedRunId, projectName, organizationId, logName } = input;
    const runId = await resolveRunId(ctx.prisma, encodedRunId, organizationId, projectName);
    const stepCap = input.stepCap ?? 500;

    return withCache<StringSeriesQueryResult>(
      ctx,
      "string-series-v1",
      { runId, organizationId, projectName, logName, stepCap },
      async () => {
        const query = `
          SELECT step, time, value, total FROM (
            SELECT
              step,
              time,
              data AS value,
              row_number() OVER (ORDER BY step ASC) AS rn,
              count() OVER () AS total
            FROM mlop_data
            WHERE tenantId = {tenantId: String}
              AND projectName = {projectName: String}
              AND runId = {runId: UInt64}
              AND logName = {logName: String}
              AND dataType = {dataType: String}
          ) AS ranked
          WHERE
            -- No "{stepCap} = 0 OR ..." disable branch: the input schema marks
            -- stepCap positive, so a caller cannot express 0 and that predicate
            -- was dead. Sampling is therefore always on, by construction — if
            -- an unsampled read is ever wanted it needs a real opt-in on the
            -- input, not a value the validator rejects.
            total <= {stepCap: UInt64}
            OR rn = 1
            OR rn = total
            OR (rn - 1) % greatest(1, intDiv(total + {stepCap: UInt64} - 1, {stepCap: UInt64})) = 0
          ORDER BY step ASC
        `;

        const raw = (await ctx.clickhouse
          .query(query, {
            tenantId: organizationId,
            projectName,
            runId,
            logName,
            dataType: STRING_SERIES_DATA_TYPE,
            stepCap,
          })
          .then((r) => r.json())) as RawRow[];

        if (raw.length === 0) {
          return { steps: [], times: [], values: [], canonicalLabels: [], truncated: false, totalSteps: 0 };
        }

        // Canonical label order: first appearance. Stable across steps, and for
        // a phase-like series it reads chronologically (warmup, train, eval,
        // done) rather than alphabetically.
        const canonicalLabels: string[] = [];
        const seen = new Set<string>();
        for (const r of raw) {
          if (!seen.has(r.value)) {
            seen.add(r.value);
            canonicalLabels.push(r.value);
          }
        }

        const totalSteps = Number(raw[0].total);
        return {
          steps: raw.map((r) => Number(r.step)),
          times: raw.map((r) => r.time),
          values: raw.map((r) => r.value),
          canonicalLabels,
          truncated: raw.length < totalSteps,
          totalSteps,
        };
      },
    );
  });
