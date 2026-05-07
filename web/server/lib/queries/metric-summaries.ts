/**
 * Query functions for the mlop_metric_summaries_v2 ReplacingMergeTree table.
 * Provides pre-computed MIN/MAX/AVG/LAST/VARIANCE per (run, metric).
 * All reads use FINAL to dedup the version-collapsed rows produced by the
 * refreshable MV (mlop_metric_summaries_v2_refresh_mv). The legacy
 * AggregatingMergeTree mlop_metric_summaries (fed by the broken incremental
 * MV) still exists alongside but is no longer read from — see
 * ingest/docker-setup/sql/02b_metric_summaries_v2.sql for context.
 */

import type { clickhouse } from "../clickhouse";
import { validateRe2Regex } from "../regex-validation";

export type MetricAggregation = "MIN" | "MAX" | "AVG" | "LAST" | "VARIANCE";

/** SQL expression for each aggregation type (applied on top of AggregatingMergeTree partial state) */
function aggExpression(agg: MetricAggregation): string {
  switch (agg) {
    case "MIN":
      return "min(min_value)";
    case "MAX":
      return "max(max_value)";
    case "AVG":
      return "sum(sum_value) / sum(count_value)";
    case "LAST":
      return "argMaxMerge(last_value)";
    case "VARIANCE":
      return "(sum(sum_sq_value)/sum(count_value)) - pow(sum(sum_value)/sum(count_value), 2)";
  }
}

// ---------------------------------------------------------------------------
// Batch metric summaries — multiple metrics for a set of runs
// ---------------------------------------------------------------------------

export interface MetricSpec {
  logName: string;
  aggregation: MetricAggregation;
}

/**
 * Fetch summaries for multiple metrics across a set of runs in one query.
 * Returns Map<runId, Map<"logName|AGG", value>>.
 *
 * Uses a single GROUP BY (runId, logName) query that computes all 5
 * aggregations at once, then maps results back to the requested specs.
 * This avoids N separate UNION ALL subqueries (one per metric spec).
 */
export async function queryMetricSummariesBatch(
  ch: typeof clickhouse,
  params: {
    organizationId: string;
    projectName: string;
    metrics: MetricSpec[];
    runIds: number[];
  },
): Promise<Map<number, Map<string, number>>> {
  const { organizationId, projectName, metrics, runIds } = params;

  if (metrics.length === 0 || runIds.length === 0) {
    return new Map();
  }

  // Collect unique logNames from all requested specs
  const logNames = [...new Set(metrics.map((m) => m.logName))];

  // Build which aggregations are needed per logName for result mapping
  const specsByLogName = new Map<string, Set<MetricAggregation>>();
  for (const m of metrics) {
    if (!specsByLogName.has(m.logName)) {
      specsByLogName.set(m.logName, new Set());
    }
    specsByLogName.get(m.logName)!.add(m.aggregation);
  }

  const queryParams: Record<string, unknown> = {
    tenantId: organizationId,
    projectName,
    runIds,
    logNames,
  };

  // Single query: GROUP BY (runId, logName), compute all aggregations
  const query = `
    SELECT
      runId,
      logName AS metric_name,
      ${aggExpression("MIN")} AS min_val,
      ${aggExpression("MAX")} AS max_val,
      ${aggExpression("AVG")} AS avg_val,
      ${aggExpression("LAST")} AS last_val,
      ${aggExpression("VARIANCE")} AS var_val
    FROM mlop_metric_summaries_v2 FINAL
    WHERE tenantId = {tenantId: String}
      AND projectName = {projectName: String}
      AND logName IN ({logNames: Array(String)})
      AND runId IN ({runIds: Array(UInt64)})
    GROUP BY runId, logName
  `;

  const result = await ch.query(query, queryParams);
  // ClickHouse serializes UInt64 as JSON string (to avoid Number.MAX_SAFE_INTEGER precision loss).
  // We coerce to number below when building the Map key.
  const rows = (await result.json()) as {
    runId: string;
    metric_name: string;
    min_val: number;
    max_val: number;
    avg_val: number;
    last_val: number;
    var_val: number;
  }[];

  // Map column names to aggregation types
  const aggToCol: Record<MetricAggregation, "min_val" | "max_val" | "avg_val" | "last_val" | "var_val"> = {
    MIN: "min_val",
    MAX: "max_val",
    AVG: "avg_val",
    LAST: "last_val",
    VARIANCE: "var_val",
  };

  const resultMap = new Map<number, Map<string, number>>();
  for (const row of rows) {
    const runId = Number(row.runId);
    if (!resultMap.has(runId)) {
      resultMap.set(runId, new Map());
    }
    const runMap = resultMap.get(runId)!;

    // Only include aggregations that were actually requested for this logName
    const requestedAggs = specsByLogName.get(row.metric_name);
    if (requestedAggs) {
      for (const agg of requestedAggs) {
        runMap.set(`${row.metric_name}|${agg}`, row[aggToCol[agg]] as number);
      }
    }
  }

  return resultMap;
}

// ---------------------------------------------------------------------------
// Argmin/argmax step — find the step where a metric's value is min/max
// ---------------------------------------------------------------------------

const IMAGE_FILE_FILTER = `(
  startsWith(fileType, 'image/')
  OR fileType IN ('png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp')
)`;

/**
 * A "best step" result — the metric step where value is min/max, along with
 * the image step the widget should render and the step distance between them.
 *
 * On the metric-only path (`queryArgminArgmaxSteps`), `imageStep`,
 * `distance`, and `tiedAlternativeImageStep` are always null — there's no
 * image coupling to report.
 *
 * On the per-widget path (`queryArgminArgmaxStepsPerImageLog`), results are
 * filtered so `distance` is always ≤ the caller-supplied tolerance
 * (nearest-snap). If no metric step within tolerance of any image exists,
 * the entry is omitted.
 *
 * `tiedAlternativeImageStep` is non-null when the nearest-snap tie-break
 * had to choose between two image steps at the same minimum distance. It
 * exposes the step that WASN'T picked, so the frontend can show a "tied
 * with step X" hint in the pin tooltip.
 */
export interface BestStepEntry {
  metricStep: number;
  metricValue: number | null;
  imageStep: number | null;
  distance: number | null;
  tiedAlternativeImageStep: number | null;
}

/**
 * Look up the global argmin / argmax step per run from
 * `mlop_metric_summaries_v2`. One row per
 * (tenantId, projectName, logName, runId), so this scan is bounded by
 * the number of selected runs — no raw mlop_metrics_v2 access.
 *
 * Returns null entry shape for runs that have no summary row yet (e.g.
 * fresh ingest before the MV materialised, or the migration to add the
 * argmin_step / argmax_step columns hasn't been backfilled). Callers
 * should fall back to the raw scan for those runs.
 */
async function queryGlobalArgminArgmaxFromSummaries(
  ch: typeof clickhouse,
  params: {
    organizationId: string;
    projectName: string;
    logName: string;
    runIds: number[];
  },
): Promise<
  Map<
    number,
    { argminStep: number; argmaxStep: number; minValue: number; maxValue: number }
  >
> {
  const { organizationId, projectName, logName, runIds } = params;
  if (runIds.length === 0) return new Map();

  const query = `
    SELECT
      runId,
      argMinMerge(argmin_step) AS argmin_step,
      argMaxMerge(argmax_step) AS argmax_step,
      min(min_value) AS min_value,
      max(max_value) AS max_value,
      sum(count_value) AS count_value
    FROM mlop_metric_summaries_v2 FINAL
    WHERE tenantId = {tenantId: String}
      AND projectName = {projectName: String}
      AND logName = {logName: String}
      AND runId IN ({runIds: Array(UInt64)})
    GROUP BY runId
  `;
  const result = await ch.query(query, {
    tenantId: organizationId,
    projectName,
    logName,
    runIds,
  });
  const rows = (await result.json()) as {
    runId: string;
    argmin_step: string;
    argmax_step: string;
    min_value: number;
    max_value: number;
    count_value: string;
  }[];
  const out = new Map<
    number,
    { argminStep: number; argmaxStep: number; minValue: number; maxValue: number }
  >();
  for (const row of rows) {
    // `count_value === 0` means the row exists but no isFinite values
    // were seen — skip; raw scan would also return nothing useful.
    if (Number(row.count_value) === 0) continue;
    out.set(Number(row.runId), {
      argminStep: Number(row.argmin_step),
      argmaxStep: Number(row.argmax_step),
      minValue: Number(row.min_value),
      maxValue: Number(row.max_value),
    });
  }
  return out;
}

/**
 * For each run, find the step where a metric reaches its min/max value
 * (no image coupling). Pure summaries lookup — one row scan per (run,
 * metric) regardless of how many data points the run logged.
 *
 * imageStep/distance/tied fields are always null on this path; callers
 * that need image coupling should use `queryArgminArgmaxStepsPerImageLog`
 * instead.
 *
 * Returns Map<runId, { argmin, argmax }>. A run is omitted entirely
 * when its summary row has no finite values (count_value === 0).
 */
export async function queryArgminArgmaxSteps(
  ch: typeof clickhouse,
  params: {
    organizationId: string;
    projectName: string;
    logName: string;
    runIds: number[];
  },
): Promise<Map<number, { argmin: BestStepEntry; argmax: BestStepEntry }>> {
  const { organizationId, projectName, logName, runIds } = params;
  if (runIds.length === 0) return new Map();

  const globals = await queryGlobalArgminArgmaxFromSummaries(ch, {
    organizationId,
    projectName,
    logName,
    runIds,
  });
  const resultMap = new Map<number, { argmin: BestStepEntry; argmax: BestStepEntry }>();
  for (const [runId, g] of globals) {
    resultMap.set(runId, {
      argmin: {
        metricStep: g.argminStep,
        metricValue: g.minValue,
        imageStep: null,
        distance: null,
        tiedAlternativeImageStep: null,
      },
      argmax: {
        metricStep: g.argmaxStep,
        metricValue: g.maxValue,
        imageStep: null,
        distance: null,
        tiedAlternativeImageStep: null,
      },
    });
  }
  return resultMap;
}

// ---------------------------------------------------------------------------
// Per-widget argmin/argmax step — for each (run, imageLogName), find the step
// where a metric reaches its min/max value with nearest-snap to that specific
// image log.
// ---------------------------------------------------------------------------

export interface PerWidgetBestStepRow {
  runId: number;
  imageLogName: string;
  argmin: BestStepEntry;
  argmax: BestStepEntry;
}

/**
 * List the (runId, imageLogName) pairs that actually have at least one
 * image file. Used by the per-widget hybrid to know which pairs to
 * expect — fast path can only tell us "I found N pairs", not "N exist
 * but I missed M of them" without this.
 */
async function queryImageLogsPerRun(
  ch: typeof clickhouse,
  params: {
    organizationId: string;
    projectName: string;
    runIds: number[];
  },
): Promise<Map<number, Set<string>>> {
  const { organizationId, projectName, runIds } = params;
  if (runIds.length === 0) return new Map();

  const query = `
    SELECT DISTINCT runId, logName
    FROM mlop_files
    WHERE tenantId = {tenantId: String}
      AND projectName = {projectName: String}
      AND runId IN ({runIds: Array(UInt64)})
      AND ${IMAGE_FILE_FILTER}
  `;
  const result = await ch.query(query, {
    tenantId: organizationId,
    projectName,
    runIds,
  });
  const rows = (await result.json()) as { runId: string; logName: string }[];
  const out = new Map<number, Set<string>>();
  for (const row of rows) {
    const runId = Number(row.runId);
    if (!out.has(runId)) out.set(runId, new Set());
    out.get(runId)!.add(row.logName);
  }
  return out;
}

/**
 * Per-image-log version of the fast-path nearest-image lookup. For each
 * (run, kind, imageLogName) triple, finds the image in `imageLogName`
 * nearest to the target step (argmin or argmax from summaries), within
 * tolerance K. Returns nested map keyed by runId then imageLogName so
 * the caller can identify which pairs were covered vs missed.
 */
async function queryNearestImagePerLogForGlobalSteps(
  ch: typeof clickhouse,
  params: {
    organizationId: string;
    projectName: string;
    runIds: number[];
    targets: Map<number, { argminStep: number; argmaxStep: number }>;
    toleranceSteps: number;
  },
): Promise<
  Map<
    number, // runId
    Map<
      string, // imageLogName
      {
        argmin?: { imageStep: number; dist: number; altImageStep: number };
        argmax?: { imageStep: number; dist: number; altImageStep: number };
      }
    >
  >
> {
  const { organizationId, projectName, runIds, targets, toleranceSteps } = params;
  if (runIds.length === 0 || targets.size === 0) return new Map();

  const tRunIds: number[] = [];
  const tSteps: number[] = [];
  const tKinds: number[] = [];
  for (const runId of runIds) {
    const t = targets.get(runId);
    if (!t) continue;
    tRunIds.push(runId);
    tSteps.push(t.argminStep);
    tKinds.push(0);
    tRunIds.push(runId);
    tSteps.push(t.argmaxStep);
    tKinds.push(1);
  }
  if (tRunIds.length === 0) return new Map();

  const query = `
    WITH targets AS (
      SELECT
        arrayJoin(arrayZip(
          {tRunIds: Array(UInt64)},
          {tSteps:  Array(UInt64)},
          {tKinds:  Array(UInt8)}
        )) AS row,
        row.1 AS runId,
        row.2 AS target_step,
        row.3 AS kind
    ),
    ranked AS (
      SELECT
        t.runId,
        t.kind,
        t.target_step,
        f.logName AS image_log,
        f.step AS image_step,
        greatest(t.target_step, f.step) - least(t.target_step, f.step) AS dist,
        row_number() OVER (
          PARTITION BY t.runId, t.kind, f.logName
          ORDER BY greatest(t.target_step, f.step) - least(t.target_step, f.step) ASC, f.step DESC
        ) AS rn,
        first_value(f.step) OVER (
          PARTITION BY t.runId, t.kind, f.logName
          ORDER BY greatest(t.target_step, f.step) - least(t.target_step, f.step) ASC, f.step ASC
        ) AS alt_image_step
      FROM targets t
      INNER JOIN mlop_files f
        ON f.tenantId = {tenantId: String}
       AND f.projectName = {projectName: String}
       AND f.runId = t.runId
      WHERE ${IMAGE_FILE_FILTER.replace(/fileType/g, "f.fileType")}
    )
    SELECT runId, kind, image_log, image_step, dist, alt_image_step
    FROM ranked
    WHERE rn = 1 AND dist <= {toleranceSteps: UInt64}
  `;

  const result = await ch.query(query, {
    tenantId: organizationId,
    projectName,
    tRunIds,
    tSteps,
    tKinds,
    toleranceSteps,
  });
  const rows = (await result.json()) as {
    runId: string;
    kind: number;
    image_log: string;
    image_step: string;
    dist: string;
    alt_image_step: string;
  }[];

  const out = new Map<
    number,
    Map<
      string,
      {
        argmin?: { imageStep: number; dist: number; altImageStep: number };
        argmax?: { imageStep: number; dist: number; altImageStep: number };
      }
    >
  >();
  for (const row of rows) {
    const runId = Number(row.runId);
    if (!out.has(runId)) out.set(runId, new Map());
    const logMap = out.get(runId)!;
    if (!logMap.has(row.image_log)) logMap.set(row.image_log, {});
    const sides = logMap.get(row.image_log)!;
    const entry = {
      imageStep: Number(row.image_step),
      dist: Number(row.dist),
      altImageStep: Number(row.alt_image_step),
    };
    if (Number(row.kind) === 0) sides.argmin = entry;
    else sides.argmax = entry;
  }
  return out;
}

/**
 * Slow-path fallback for the per-widget query. Same SQL as the original
 * raw nearest-snap, but filtered to a specific list of (runId,
 * imageLogName) pairs so we don't redo work the fast path already did.
 * When called with all pairs for some runs (i.e. the fast path covered
 * none), behaves identically to the pre-hybrid version.
 */
async function queryArgminArgmaxStepsPerImageLogRawFallback(
  ch: typeof clickhouse,
  params: {
    organizationId: string;
    projectName: string;
    logName: string;
    pairs: Array<{ runId: number; imageLogName: string }>;
    toleranceSteps: number;
  },
): Promise<PerWidgetBestStepRow[]> {
  const { organizationId, projectName, logName, pairs, toleranceSteps } = params;
  if (pairs.length === 0) return [];

  const pRunIds = pairs.map((p) => p.runId);
  const pLogNames = pairs.map((p) => p.imageLogName);

  // Filter the join down to exactly the requested (runId, imageLogName)
  // pairs by joining mlop_metrics × mlop_files against an inline pair
  // table built from parallel arrays. Doing it as a JOIN (rather than
  // a tuple IN) lets CH plan it as a hash join, which beats the
  // subquery approach on large pair sets.
  const query = `
    WITH pair_filter AS (
      SELECT
        arrayJoin(arrayZip(
          {pRunIds:   Array(UInt64)},
          {pLogNames: Array(String)}
        )) AS row,
        row.1 AS pair_runId,
        row.2 AS pair_imageLogName
    )
    SELECT
      runId,
      image_log AS imageLogName,
      argMin((metric_step, image_step, dist, alt_image_step, metric_value), metric_value) AS argmin_tuple,
      argMax((metric_step, image_step, dist, alt_image_step, metric_value), metric_value) AS argmax_tuple
    FROM (
      SELECT
        m.runId AS runId,
        m.step AS metric_step,
        m.value AS metric_value,
        f.step AS image_step,
        f.logName AS image_log,
        greatest(m.step, f.step) - least(m.step, f.step) AS dist,
        row_number() OVER (
          PARTITION BY m.runId, m.step, f.logName
          ORDER BY greatest(m.step, f.step) - least(m.step, f.step) ASC, f.step DESC
        ) AS rn,
        first_value(f.step) OVER (
          PARTITION BY m.runId, m.step, f.logName
          ORDER BY greatest(m.step, f.step) - least(m.step, f.step) ASC, f.step ASC
        ) AS alt_image_step
      FROM mlop_metrics_v2 m FINAL
      INNER JOIN mlop_files f
        ON m.tenantId = f.tenantId
       AND m.projectName = f.projectName
       AND m.runId = f.runId
      INNER JOIN pair_filter p
        ON p.pair_runId = m.runId
       AND p.pair_imageLogName = f.logName
      WHERE m.tenantId = {tenantId: String}
        AND m.projectName = {projectName: String}
        AND m.logName = {logName: String}
        AND isFinite(m.value)
        AND ${IMAGE_FILE_FILTER.replace(/fileType/g, "f.fileType")}
    ) t
    WHERE rn = 1 AND dist <= {toleranceSteps: UInt64}
    GROUP BY runId, image_log
  `;

  const result = await ch.query(query, {
    tenantId: organizationId,
    projectName,
    logName,
    pRunIds,
    pLogNames,
    toleranceSteps,
  });

  const rows = (await result.json()) as {
    runId: string;
    imageLogName: string;
    // (metric_step, image_step, dist, alt_image_step, metric_value)
    argmin_tuple: [string, string, string, string, number];
    argmax_tuple: [string, string, string, string, number];
  }[];

  const toEntry = (t: [string, string, string, string, number]): BestStepEntry => {
    const imageStep = Number(t[1]);
    const altImageStep = Number(t[3]);
    return {
      metricStep: Number(t[0]),
      metricValue: Number(t[4]),
      imageStep,
      distance: Number(t[2]),
      tiedAlternativeImageStep: altImageStep === imageStep ? null : altImageStep,
    };
  };

  return rows.map((r) => ({
    runId: Number(r.runId),
    imageLogName: r.imageLogName,
    argmin: toEntry(r.argmin_tuple),
    argmax: toEntry(r.argmax_tuple),
  }));
}

/**
 * For each (run, image logName) pair, find the metric step where a given
 * metric reaches its min/max value, snapping each metric row to the nearest
 * image step within the tolerance. Enables per-widget pinning: different
 * image widgets can pin the same run at different steps, even when their
 * image cadences differ.
 *
 * Hybrid:
 *   1. Look up global argmin/argmax steps from the summaries table.
 *   2. Look up nearest image per (run, kind, imageLogName) within K.
 *   3. For (run, imageLogName) pairs where both argmin AND argmax got an
 *      image hit → use the fast-path result.
 *   4. For pairs where the fast path missed (the global argmin/argmax is
 *      too far from any image in that log) → fall back to the raw scan,
 *      filtered to just those pairs. The raw scan considers every metric
 *      step, so it can find a non-global-min/max metric step that
 *      happens to have an image within K for that specific image log.
 *
 * The fast path tends to hit when a run has a single image log (or
 * multiple logs co-logged on the same cadence as the metric); the
 * fallback dominates when image logs have mixed cadences. Worst case
 * adds a few cheap lookups before paying the same raw-scan cost as
 * before; best case skips the raw scan entirely.
 */
export async function queryArgminArgmaxStepsPerImageLog(
  ch: typeof clickhouse,
  params: {
    organizationId: string;
    projectName: string;
    logName: string;
    runIds: number[];
    toleranceSteps: number;
  },
): Promise<PerWidgetBestStepRow[]> {
  const { organizationId, projectName, logName, runIds, toleranceSteps } = params;

  if (runIds.length === 0) return [];

  // Fire the two independent lookups in parallel; the fast-path image
  // lookup depends on `globals` so it follows.
  const [expectedPairs, globals] = await Promise.all([
    queryImageLogsPerRun(ch, { organizationId, projectName, runIds }),
    queryGlobalArgminArgmaxFromSummaries(ch, { organizationId, projectName, logName, runIds }),
  ]);
  const fastPath = await queryNearestImagePerLogForGlobalSteps(ch, {
    organizationId,
    projectName,
    runIds: Array.from(globals.keys()),
    targets: globals,
    toleranceSteps,
  });

  // Walk every expected (run, imageLogName) pair. Pairs where the fast
  // path covered both argmin AND argmax become fast-path rows; the rest
  // are queued for the raw fallback.
  const fastRows: PerWidgetBestStepRow[] = [];
  const fallbackPairs: Array<{ runId: number; imageLogName: string }> = [];
  for (const [runId, logSet] of expectedPairs) {
    const g = globals.get(runId);
    const fpRun = fastPath.get(runId);
    for (const imageLogName of logSet) {
      const fp = fpRun?.get(imageLogName);
      if (g && fp?.argmin && fp?.argmax) {
        const argminAlt = fp.argmin.altImageStep;
        const argmaxAlt = fp.argmax.altImageStep;
        fastRows.push({
          runId,
          imageLogName,
          argmin: {
            metricStep: g.argminStep,
            metricValue: g.minValue,
            imageStep: fp.argmin.imageStep,
            distance: fp.argmin.dist,
            tiedAlternativeImageStep: argminAlt === fp.argmin.imageStep ? null : argminAlt,
          },
          argmax: {
            metricStep: g.argmaxStep,
            metricValue: g.maxValue,
            imageStep: fp.argmax.imageStep,
            distance: fp.argmax.dist,
            tiedAlternativeImageStep: argmaxAlt === fp.argmax.imageStep ? null : argmaxAlt,
          },
        });
      } else {
        fallbackPairs.push({ runId, imageLogName });
      }
    }
  }

  // Fallback for pairs where the fast path didn't have both sides.
  const slowRows = await queryArgminArgmaxStepsPerImageLogRawFallback(ch, {
    organizationId,
    projectName,
    logName,
    pairs: fallbackPairs,
    toleranceSteps,
  });

  return [...fastRows, ...slowRows];
}

// ---------------------------------------------------------------------------
// Distinct metric names in a project
// ---------------------------------------------------------------------------

export async function queryDistinctMetrics(
  ch: typeof clickhouse,
  params: {
    organizationId: string;
    projectName: string;
    search?: string;
    regex?: string;
    limit?: number;
    runIds?: number[];
    includeNonFiniteMetrics?: boolean;
  },
): Promise<{ metricNames: string[]; nonFiniteOnlyMetrics: string[] }> {
  const { organizationId, projectName, search, regex, limit = 500, runIds, includeNonFiniteMetrics } = params;

  const queryParams: Record<string, unknown> = {
    tenantId: organizationId,
    projectName,
    limit,
  };

  let searchFilter = "";
  let orderClause = "ORDER BY logName ASC";

  const trimmedRegex = regex?.trim();
  if (trimmedRegex) {
    // ClickHouse match() uses re2 regex engine — validate before sending
    // to prevent CANNOT_COMPILE_REGEXP errors (Code 427).
    const re2Check = validateRe2Regex(trimmedRegex);
    if (!re2Check.valid) {
      console.warn(
        `[queryDistinctMetrics] Rejected invalid re2 regex: ${re2Check.reason} — pattern: ${trimmedRegex.slice(0, 100)}`,
      );
      return { metricNames: [], nonFiniteOnlyMetrics: [] };
    }
    searchFilter = `AND match(logName, {regex: String})`;
    queryParams.regex = trimmedRegex;
  } else if (search && search.trim()) {
    const trimmed = search.trim();
    // Fuzzy match with Levenshtein distance: allow 1 edit for short terms (<4 chars),
    // 2 edits for longer terms. Lowered from 2/3 to reduce false positives.
    searchFilter = `AND (multiFuzzyMatchAny(lower(logName), if(length({search: String}) < 4, 1, 2), [lower({search: String})]) = 1
         OR logName ILIKE {searchPattern: String})`;
    queryParams.search = trimmed;
    queryParams.searchPattern = `%${trimmed}%`;
    orderClause = "ORDER BY logName ILIKE {searchPattern: String} DESC, logName ASC";
  }

  let runIdFilter = "";
  if (runIds && runIds.length > 0) {
    runIdFilter = `AND runId IN ({runIds: Array(UInt64)})`;
    queryParams.runIds = runIds;
  }

  // Use the pre-aggregated summaries table by default — it's orders of magnitude
  // faster than scanning the raw metrics table. Only fall back to mlop_metrics
  // when includeNonFiniteMetrics is explicitly requested, since the materialized
  // view that populates summaries has a WHERE isFinite(value) filter (metrics
  // whose values are ALL NaN/Inf won't appear in summaries).
  const useRawTable = !!(includeNonFiniteMetrics && runIds && runIds.length > 0);

  // When hitting the raw table we also compute a `hasFinite` aggregate per
  // logName in the same pass — metrics with no finite values are entirely
  // NaN/Inf and get flagged so the UI can mark them with a distinct icon.
  // On the summaries table path, hasFinite is implicitly true (the MV filters
  // out non-finite rows), so we return the same column as a constant.
  const query = useRawTable
    ? `
      SELECT logName, countIf(isFinite(value)) > 0 AS hasFinite
      FROM mlop_metrics_v2 FINAL
      WHERE tenantId = {tenantId: String}
        AND projectName = {projectName: String}
        ${searchFilter}
        ${runIdFilter}
      GROUP BY logName
      ${orderClause}
      LIMIT {limit: UInt32}
    `
    : `
      SELECT logName, 1 AS hasFinite
      FROM mlop_metric_summaries_v2 FINAL
      WHERE tenantId = {tenantId: String}
        AND projectName = {projectName: String}
        ${searchFilter}
        ${runIdFilter}
      GROUP BY logName
      ${orderClause}
      LIMIT {limit: UInt32}
    `;

  try {
    const result = await ch.query(query, queryParams, {
      label: `queryDistinctMetrics:${useRawTable ? "raw" : "summaries"}`,
    });
    const rows = (await result.json()) as { logName: string; hasFinite: number | boolean }[];
    const metricNames: string[] = [];
    const nonFiniteOnlyMetrics: string[] = [];
    for (const r of rows) {
      metricNames.push(r.logName);
      // ClickHouse returns UInt8 (0/1) for the boolean comparison — coerce.
      if (useRawTable && !r.hasFinite) {
        nonFiniteOnlyMetrics.push(r.logName);
      }
    }
    return { metricNames, nonFiniteOnlyMetrics };
  } catch (error: unknown) {
    // Gracefully handle ClickHouse regex compilation errors (Code 427)
    // instead of propagating 500s to the client.
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("CANNOT_COMPILE_REGEXP") || message.includes("427")) {
      console.warn(
        `[queryDistinctMetrics] ClickHouse regex error: ${message.slice(0, 200)}`,
      );
      return { metricNames: [], nonFiniteOnlyMetrics: [] };
    }
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Metric sort query — returns sorted runIds from ClickHouse
// ---------------------------------------------------------------------------

export interface MetricFilterSpec {
  logName: string;
  aggregation: MetricAggregation;
  operator: string;
  values: unknown[];
}

/**
 * Query ClickHouse for run IDs sorted by a metric aggregation.
 * Supports optional metric filters and a candidate run ID set (from PG pre-filtering).
 */
export async function queryMetricSortedRunIds(
  ch: typeof clickhouse,
  params: {
    organizationId: string;
    projectName: string;
    sortLogName: string;
    sortAggregation: MetricAggregation;
    sortDirection: "ASC" | "DESC";
    limit: number;
    offset: number;
    candidateRunIds?: number[];
    metricFilters?: MetricFilterSpec[];
  },
): Promise<{ runId: number; sortValue: number }[]> {
  const {
    organizationId,
    projectName,
    sortLogName,
    sortAggregation,
    sortDirection,
    limit,
    offset,
    candidateRunIds,
    metricFilters,
  } = params;

  const queryParams: Record<string, unknown> = {
    tenantId: organizationId,
    projectName,
    sortLogName,
    limit,
    offset,
  };

  let candidateFilter = "";
  if (candidateRunIds && candidateRunIds.length > 0) {
    candidateFilter = "AND runId IN ({candidateRunIds: Array(UInt64)})";
    queryParams.candidateRunIds = candidateRunIds;
  }

  // Build HAVING clause for metric filters
  const havingClauses: string[] = [];
  if (metricFilters && metricFilters.length > 0) {
    for (let i = 0; i < metricFilters.length; i++) {
      const mf = metricFilters[i];
      const logNameParam = `mf_logName_${i}`;
      queryParams[logNameParam] = mf.logName;

      // For each metric filter, add a subquery-based HAVING condition
      // We check it via a separate correlated condition
      const aggExpr = aggExpression(mf.aggregation);
      const cond = buildMetricFilterCondition(aggExpr, mf.operator, mf.values, queryParams, `mf_${i}`);
      if (cond) {
        havingClauses.push(cond);
      }
    }
  }

  // If metric filters target different logNames than the sort logName,
  // we need a different approach: use sub-selects or INTERSECT.
  // For simplicity, we use a CTE approach with INTERSECT.

  // Step 1: Get runIds that pass all metric filters
  let filterCTE = "";
  if (metricFilters && metricFilters.length > 0) {
    const filterSubqueries: string[] = [];
    for (let i = 0; i < metricFilters.length; i++) {
      const mf = metricFilters[i];
      const logNameParam = `mf_logName_${i}`;
      const aggExpr = aggExpression(mf.aggregation);
      const havingCond = buildMetricFilterCondition(aggExpr, mf.operator, mf.values, queryParams, `mf_${i}`);
      if (!havingCond) continue;

      filterSubqueries.push(`
        SELECT runId
        FROM mlop_metric_summaries_v2 FINAL
        WHERE tenantId = {tenantId: String}
          AND projectName = {projectName: String}
          AND logName = {${logNameParam}: String}
          ${candidateFilter}
        GROUP BY runId
        HAVING ${havingCond}
      `);
    }
    if (filterSubqueries.length > 0) {
      filterCTE = `filtered_runs AS (
        ${filterSubqueries.join(" INTERSECT ")}
      ),`;
    }
  }

  const filterJoin = filterCTE
    ? "AND runId IN (SELECT runId FROM filtered_runs)"
    : "";

  const sortAggExpr = aggExpression(sortAggregation);

  const query = `
    WITH ${filterCTE}
    sorted AS (
      SELECT
        runId,
        ${sortAggExpr} AS sort_value
      FROM mlop_metric_summaries_v2 FINAL
      WHERE tenantId = {tenantId: String}
        AND projectName = {projectName: String}
        AND logName = {sortLogName: String}
        ${candidateFilter}
        ${filterJoin}
      GROUP BY runId
      ORDER BY sort_value ${sortDirection}
      LIMIT {limit: UInt32}
      OFFSET {offset: UInt32}
    )
    SELECT runId, sort_value AS sortValue FROM sorted
  `;

  const t0 = performance.now();
  const result = await ch.query(query, queryParams);
  const t1 = performance.now();
  const rows = (await result.json()) as { runId: number; sortValue: number }[];
  const t2 = performance.now();
  console.log(`[queryMetricSortedRunIds] ${params.sortLogName} ${params.sortAggregation} — CH query: ${(t1-t0).toFixed(0)}ms, JSON parse: ${(t2-t1).toFixed(0)}ms, ${rows.length} rows`);
  return rows;
}

/**
 * Query ClickHouse for run IDs matching metric filters (no sort — just filtering).
 * Used when sort is by a non-metric column but metric filters are active.
 */
export async function queryMetricFilteredRunIds(
  ch: typeof clickhouse,
  params: {
    organizationId: string;
    projectName: string;
    metricFilters: MetricFilterSpec[];
    candidateRunIds?: number[];
  },
): Promise<number[]> {
  const { organizationId, projectName, metricFilters, candidateRunIds } = params;

  if (metricFilters.length === 0) return [];

  const queryParams: Record<string, unknown> = {
    tenantId: organizationId,
    projectName,
  };

  let candidateFilter = "";
  if (candidateRunIds && candidateRunIds.length > 0) {
    candidateFilter = "AND runId IN ({candidateRunIds: Array(UInt64)})";
    queryParams.candidateRunIds = candidateRunIds;
  }

  const subqueries: string[] = [];
  for (let i = 0; i < metricFilters.length; i++) {
    const mf = metricFilters[i];
    const logNameParam = `mf_logName_${i}`;
    queryParams[logNameParam] = mf.logName;

    const aggExpr = aggExpression(mf.aggregation);
    const havingCond = buildMetricFilterCondition(aggExpr, mf.operator, mf.values, queryParams, `mf_${i}`);
    if (!havingCond) continue;

    subqueries.push(`
      SELECT runId
      FROM mlop_metric_summaries_v2 FINAL
      WHERE tenantId = {tenantId: String}
        AND projectName = {projectName: String}
        AND logName = {${logNameParam}: String}
        ${candidateFilter}
      GROUP BY runId
      HAVING ${havingCond}
    `);
  }

  if (subqueries.length === 0) return [];

  const query = subqueries.join(" INTERSECT ");
  const result = await ch.query(query, queryParams);
  const rows = (await result.json()) as { runId: number }[];
  return rows.map((r) => r.runId);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildMetricFilterCondition(
  aggExpr: string,
  operator: string,
  values: unknown[],
  queryParams: Record<string, unknown>,
  prefix: string,
): string | null {
  const v0 = values[0] != null ? Number(values[0]) : NaN;

  switch (operator) {
    case "is":
    case "=": {
      if (isNaN(v0)) return null;
      queryParams[`${prefix}_v0`] = v0;
      return `${aggExpr} = {${prefix}_v0: Float64}`;
    }
    case "is not":
    case "!=": {
      if (isNaN(v0)) return null;
      queryParams[`${prefix}_v0`] = v0;
      return `${aggExpr} != {${prefix}_v0: Float64}`;
    }
    case "is greater than":
    case ">": {
      if (isNaN(v0)) return null;
      queryParams[`${prefix}_v0`] = v0;
      return `${aggExpr} > {${prefix}_v0: Float64}`;
    }
    case "is less than":
    case "<": {
      if (isNaN(v0)) return null;
      queryParams[`${prefix}_v0`] = v0;
      return `${aggExpr} < {${prefix}_v0: Float64}`;
    }
    case "is greater than or equal to":
    case ">=": {
      if (isNaN(v0)) return null;
      queryParams[`${prefix}_v0`] = v0;
      return `${aggExpr} >= {${prefix}_v0: Float64}`;
    }
    case "is less than or equal to":
    case "<=": {
      if (isNaN(v0)) return null;
      queryParams[`${prefix}_v0`] = v0;
      return `${aggExpr} <= {${prefix}_v0: Float64}`;
    }
    case "is between": {
      if (isNaN(v0)) return null;
      const v1 = values[1] != null ? Number(values[1]) : NaN;
      if (isNaN(v1)) return null;
      queryParams[`${prefix}_v0`] = v0;
      queryParams[`${prefix}_v1`] = v1;
      return `${aggExpr} BETWEEN {${prefix}_v0: Float64} AND {${prefix}_v1: Float64}`;
    }
    case "is not between": {
      if (isNaN(v0)) return null;
      const v1 = values[1] != null ? Number(values[1]) : NaN;
      if (isNaN(v1)) return null;
      queryParams[`${prefix}_v0`] = v0;
      queryParams[`${prefix}_v1`] = v1;
      return `${aggExpr} NOT BETWEEN {${prefix}_v0: Float64} AND {${prefix}_v1: Float64}`;
    }
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Single-run metric latest values (for file view)
// ---------------------------------------------------------------------------

export interface RunMetricValue {
  logName: string;
  lastValue: number;
  minValue: number;
  maxValue: number;
  avgValue: number;
  count: number;
}

/**
 * Fetch the latest value (and summary stats) for ALL metrics of a single run.
 * Used by the file view to display metrics alongside files (Neptune-style).
 */
export async function queryRunMetricValues(
  ch: typeof clickhouse,
  params: {
    organizationId: string;
    projectName: string;
    runId: number;
    limit?: number;
  },
): Promise<RunMetricValue[]> {
  const { organizationId, projectName, runId, limit = 1000 } = params;

  const query = `
    SELECT
      logName,
      ${aggExpression("LAST")} AS lastValue,
      ${aggExpression("MIN")} AS minValue,
      ${aggExpression("MAX")} AS maxValue,
      ${aggExpression("AVG")} AS avgValue,
      sum(count_value) AS count
    FROM mlop_metric_summaries_v2 FINAL
    WHERE tenantId = {tenantId: String}
      AND projectName = {projectName: String}
      AND runId = {runId: UInt64}
    GROUP BY logName
    ORDER BY logName ASC
    LIMIT {limit: UInt32}
  `;

  const result = await ch.query(query, {
    tenantId: organizationId,
    projectName,
    runId,
    limit,
  });

  return (await result.json()) as RunMetricValue[];
}
