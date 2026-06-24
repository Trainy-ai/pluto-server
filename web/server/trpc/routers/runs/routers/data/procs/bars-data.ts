import { TRPCError } from "@trpc/server";
import { protectedOrgProcedure } from "../../../../../../lib/trpc";
import { resolveRunId } from "../../../../../../lib/resolve-run-id";
import { withCache } from "../../../../../../lib/cache";
import {
  BARS_MIN_SUFFIXES,
  barsDataInput,
  type BarsDataRow,
  type BarsDataQueryResult,
} from "./histogram.schema";

interface RawRow {
  step: number | string;
  labels: string[];
  freq: Array<number | string>;
  total: number | string;
}

// Bars-data proc: roll up scalar metrics under `pathPrefix` into per-step
// bar-chart payloads (the {bars} widget's data source). Reads from
// mlop_metrics — user-logged scalars like
// `pluto.log({"training/dataset/dsN": count}, step=...)`, NOT
// `pluto.Histogram(...)` files. Suffix after the prefix becomes the bar
// label; scalar value becomes the bar height. Bar ordering is canonical
// (max-value desc across the run) and stable across steps so the view
// doesn't reorder bars as the slider scrubs.
export const barsDataProcedure = protectedOrgProcedure
  .input(barsDataInput)
  .query(async ({ ctx, input }) => {
    const { runId: encodedRunId, projectName, organizationId, pathPrefix } = input;
    const runId = await resolveRunId(ctx.prisma, encodedRunId, organizationId, projectName);

    // Default cap: 500 sampled steps per run. With 10k+ training steps this
    // is the difference between a 19MB payload across 8 runs and a ~1MB
    // payload, and the renderer downsamples further (~30 ridges, ~200
    // heatmap rows) regardless, so 500 is the highest fidelity any view
    // can actually use. Callers can override with explicit stepCap.
    const stepCap = input.stepCap ?? 500;

    // Cache namespace is `bars-data-v1` after the rename from
    // `categorical-histogram-v2`. The bump invalidates the prior namespace
    // — one-time cache miss for any cached prefix on first read post-deploy.
    return withCache<BarsDataQueryResult>(
      ctx,
      "bars-data-v1",
      { runId, organizationId, projectName, pathPrefix, stepCap },
      async () => {
        const stepCapValue = stepCap;

        // Per (step, label) we take argMax(value, time) so that a metric
        // logged twice in the same step lands on the most recent write,
        // matching how scalar-metric line charts already collapse duplicates.
        // The outer window function applies the same stride-based step-cap
        // logic as the uniform histogram proc.
        const query = `
          WITH per_step AS (
            SELECT
              step,
              substring(logName, length({prefix: String}) + 1) AS label,
              argMax(value, time) AS value
            FROM mlop_metrics
            WHERE tenantId = {tenantId: String}
              AND projectName = {projectName: String}
              AND runId = {runId: UInt64}
              AND startsWith(logName, {prefix: String})
              AND substring(logName, length({prefix: String}) + 1) != ''
            GROUP BY step, logName
          ),
          per_step_grouped AS (
            SELECT
              step,
              groupArray(label) AS labels,
              groupArray(value) AS freq
            FROM per_step
            GROUP BY step
          )
          SELECT step, labels, freq, total
          FROM (
            SELECT
              step,
              labels,
              freq,
              row_number() OVER (ORDER BY step ASC) AS rn,
              count() OVER () AS total
            FROM per_step_grouped
          )
          WHERE
            {stepCap: UInt64} = 0
            OR total <= {stepCap: UInt64}
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
            prefix: pathPrefix,
            stepCap: stepCapValue,
          })
          .then((r) => r.json())) as RawRow[];

        if (raw.length === 0) {
          return { rows: [], truncated: false, totalSteps: 0, canonicalLabels: [] };
        }

        // Build canonical label order: max-value desc across the run. Steps
        // with missing labels zero-fill so bin positions stay stable while
        // the slider scrubs.
        const labelMax = new Map<string, number>();
        for (const r of raw) {
          for (let i = 0; i < r.labels.length; i++) {
            const v = Number(r.freq[i]);
            const cur = labelMax.get(r.labels[i]) ?? -Infinity;
            if (v > cur) labelMax.set(r.labels[i], v);
          }
        }

        // Eligibility enforcement (defense in depth — the dropdown filters
        // by the same threshold, but a hand-edited dashboard config could
        // still ask for an under-threshold prefix).
        if (labelMax.size < BARS_MIN_SUFFIXES) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              `Prefix "${pathPrefix}" has only ${labelMax.size} suffix(es); ` +
              `{bars} widgets require at least ${BARS_MIN_SUFFIXES}.`,
          });
        }

        const canonicalLabels = Array.from(labelMax.entries())
          .sort((a, b) => {
            if (b[1] !== a[1]) return b[1] - a[1];
            return a[0].localeCompare(b[0]);
          })
          .map(([label]) => label);

        const labelIndex = new Map<string, number>();
        canonicalLabels.forEach((label, idx) => labelIndex.set(label, idx));

        const totalSteps = Number(raw[0].total);
        const rows: BarsDataRow[] = raw.map((r) => {
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

        const truncated = rows.length < totalSteps;
        return { rows, truncated, totalSteps, canonicalLabels };
      }
    );
  });
