import { protectedOrgProcedure } from "../../../../../../lib/trpc";
import { resolveRunId } from "../../../../../../lib/resolve-run-id";
import { withCache } from "../../../../../../lib/cache";
import {
  BARS_MIN_SUFFIXES,
  eligiblePrefixesInput,
  type EligiblePrefixEntry,
} from "./histogram.schema";

// Enumerate path prefixes whose suffix-count meets the eligibility threshold
// for {bars} rollup. Returns the DEEPEST prefix per metric
// path (the path-segment before the last `/`), so e.g. for metrics
// `training/dataset/dsA`, `training/dataset/dsB`, `training/dataset/dsC` the
// returned prefix is `training/dataset/` with suffixCount=3. A metric with no
// `/` (e.g. `loss`) has no prefix and is excluded entirely.
//
// When `runId` is provided, scoped to that single run. When omitted, scoped
// to the whole project — used by the Add-Widget Files dropdown so `{bars}`
// entries surface even before the user selects any runs on the dashboard.
export const eligiblePrefixesProcedure = protectedOrgProcedure
  .input(eligiblePrefixesInput)
  .query(async ({ ctx, input }) => {
    const { runId: encodedRunId, projectName, organizationId } = input;
    let runId: number | null = null;
    if (encodedRunId) {
      runId = await resolveRunId(ctx.prisma, encodedRunId, organizationId, projectName);
    }

    return withCache<EligiblePrefixEntry[]>(
      ctx,
      "eligible-prefixes-v1",
      // withCache requires runId: number — use 0 as the "project-wide"
      // sentinel. Real runIds are positive integers from Prisma's BigInt,
      // so 0 can't collide with a real per-run cache entry.
      { runId: runId ?? 0, organizationId, projectName },
      async () => {
        // For each metric path, take everything up to and including the
        // FINAL `/` as the prefix. Group by that prefix, count distinct
        // logNames. Filter to prefixes with >= MIN_SUFFIXES children.
        //
        // Reads from mlop_metric_summaries_v2 (one row per (run, logName))
        // instead of mlop_metrics (one row per (run, logName, step)). The
        // summaries table is ~300x smaller — project-wide queries that
        // previously scanned 150M rows / 3.4s now scan 50k rows / 12ms.
        // FINAL is required because the summaries table is a
        // ReplacingMergeTree.
        //
        // `uniqExact(logName)` is shared by both branches (project-wide
        // counts dedupe across runs naturally — if logName "layers/foo"
        // appears in 3 runs it still contributes 1 to the suffix count).
        const runFilter = runId !== null
          ? `AND runId = {runId: UInt64}`
          : ``;
        const query = `
          SELECT
            substring(logName, 1, length(logName) - position(reverse(logName), '/') + 1) AS prefix,
            uniqExact(logName) AS suffix_count
          FROM mlop_metric_summaries_v2 FINAL
          WHERE tenantId = {tenantId: String}
            AND projectName = {projectName: String}
            ${runFilter}
            AND position(logName, '/') > 0
          GROUP BY prefix
          HAVING suffix_count >= {minSuffixes: UInt32}
          ORDER BY suffix_count DESC, prefix ASC
        `;

        const params: Record<string, string | number> = {
          tenantId: organizationId,
          projectName,
          minSuffixes: BARS_MIN_SUFFIXES,
        };
        if (runId !== null) params.runId = runId;

        const raw = (await ctx.clickhouse
          .query(query, params)
          .then((r) => r.json())) as Array<{
          prefix: string;
          suffix_count: number | string;
        }>;

        const entries = raw.map((r) => ({
          prefix: r.prefix,
          suffixCount: Number(r.suffix_count),
        }));

        // Suppress "ancestor" prefixes when a deeper prefix exists. E.g.
        // if both `layers/` and `layers/layer_0/` qualify, keep only the
        // deeper one — the shallower one is a mixed bag of leaf metrics
        // and entire sub-trees, which makes a confusing bin axis. The
        // user wants the cleanest deepest-only view.
        const prefixSet = new Set(entries.map((e) => e.prefix));
        return entries.filter((e) =>
          ![...prefixSet].some(
            (other) => other !== e.prefix && other.startsWith(e.prefix),
          ),
        );
      }
    );
  });
