import { z } from "zod";
import { createHash } from "node:crypto";
import { protectedOrgProcedure } from "../../../../lib/trpc";
import { sqidEncode } from "../../../../lib/sqid";
import { clickhouse } from "../../../../lib/clickhouse";
import { getCached, setCached, CACHE_TTL } from "../../../../lib/cache";
import { queryFinalMetricValues } from "../final-metric-values";
import {
  parseSweepBlock,
  inferSweptKeys,
  type SweepMeta,
  type SweepGoal,
} from "../sweep-config";
import { computeParamStats, type ParamStat } from "../param-stats";
import {
  summarizeStatuses,
  deriveState,
  gridTotal,
  type StatusCounts,
  type SweepState,
} from "../sweep-progress";

export interface SweepRun {
  /** Sqid — what the run routes and the rest of the app address runs by. */
  runId: string;
  name: string;
  displayId: string | null;
  status: string;
  createdAt: Date;
  /** Only the scalar entries; nested blocks like `wandb` are dropped. */
  config: Record<string, unknown>;
  /** Final value of the resolved metric, or null when this run never logged it. */
  metricValue: number | null;
  /** The run's page on wandb, for migrated runs. Null for native ones. */
  wandbUrl: string | null;
}

export interface SweepDetail extends SweepMeta {
  sweepId: string;
  fromWandb: boolean;
  state: SweepState;
  statuses: StatusCounts;
  gridTotal: number | null;
  runs: SweepRun[];
  /** Config keys that vary across the sweep — the parallel-coords axes. */
  sweptKeys: string[];
  /**
   * Every non-system metric logged by *any* run in the sweep, sorted. The union
   * rather than the intersection: a metric only some runs logged still charts,
   * it just leaves gaps, and hiding it would make the picker lie about what is
   * there.
   */
  availableMetrics: string[];
  /** Per-parameter importance + correlation, most important first. Empty
   *  when there are too few scored runs for the numbers to mean anything. */
  paramStats: ParamStat[];
  /** Metric the paramStats were computed against. */
  statsMetric: string | null;
  /** Which metric the values are for, and how it was chosen. */
  resolvedMetric: {
    name: string | null;
    goal: SweepGoal;
    source: "sweep-config" | "requested" | "inferred" | "none";
  };
}

/** System metrics are noise in a sweep picker — the objective is never one. */
const SYS_PREFIX = "sys/";

/**
 * Fit the importance forest, or return an earlier fit of the same input.
 *
 * The forest is the one genuinely expensive thing on this page — it is CPU on
 * the event loop, not a database round trip, so while it runs nothing else on
 * the pod progresses. It also re-fires on every control on the panel (metric
 * picker, goal, "include non-swept config"), each of which is a query input.
 *
 * The key is a digest of the *exact* input to `computeParamStats`, so a stale
 * answer is not expressible: any change to a config, a metric value or the
 * column set produces a different key. The TTL is therefore only an eviction
 * bound, not a correctness one, which is why a finished and a running sweep can
 * share the same generous value.
 */
async function cachedParamStats(
  organizationId: string,
  projectName: string,
  sweepId: string,
  runs: { config: Record<string, unknown>; metricValue: number | null }[],
  keys: string[],
): Promise<ParamStat[]> {
  const digest = createHash("sha1")
    .update(
      JSON.stringify([
        keys,
        runs.map((run) => [run.metricValue, keys.map((k) => run.config[k])]),
      ]),
    )
    .digest("base64url");
  const cacheKey = `mlop:sweeps.paramStats:org=${organizationId}:project=${projectName}:sweep=${sweepId}:input=${digest}`;

  const cached = await getCached<ParamStat[]>(cacheKey);
  if (cached) {
    return cached;
  }
  const stats = computeParamStats(runs, keys);
  await setCached(cacheKey, stats, CACHE_TTL.COMPLETED);
  return stats;
}

/**
 * One sweep: its runs, their hyperparameters, and their objective values.
 *
 * The metric is resolved in a fixed order — an explicit request wins, then the
 * migrated sweep's declared `metric.name`, then the alphabetically first
 * non-system metric these runs logged. The order matters because a *native*
 * sweep declares nothing server-side (the SDK keeps its config on the agent's
 * disk), so without the inference step half the feature would be blank for
 * exactly the sweeps a user just ran themselves. `resolvedMetric.source` is
 * returned so the UI can say which rule fired instead of silently picking.
 */
export const getSweepProcedure = protectedOrgProcedure
  .input(
    z.object({
      projectName: z.string(),
      sweepId: z.string().max(200),
      /** Override the objective metric (the picker). */
      metric: z.string().max(500).optional(),
      /** Override the direction; defaults to the sweep's declared goal. */
      goal: z.enum(["minimize", "maximize"]).optional(),
      /**
       * Metric the importance panel is computed against. Independent of the
       * page objective, so you can ask "what drove train_time?" without
       * re-axing the chart and the best-run highlight.
       */
      statsMetric: z.string().max(500).optional(),
      /**
       * Widen the importance columns from the swept parameters to every config
       * key that varies. The forest is fitted jointly, so the column set changes
       * the attribution — it cannot be a client-side filter.
       */
      includeAllConfig: z.boolean().optional(),
    }),
  )
  .query(async ({ ctx, input }): Promise<SweepDetail | null> => {
    const project = await ctx.prisma.projects.findFirst({
      where: { name: input.projectName, organizationId: input.organizationId },
      // runPrefix builds the human display id (`UCH-12`); it lives on the
      // project, not the run, so it has to come back with this lookup.
      select: { id: true, runPrefix: true },
    });
    if (!project) {
      return null;
    }

    const runs = await ctx.prisma.runs.findMany({
      where: {
        projectId: project.id,
        organizationId: input.organizationId,
        tags: { has: `sweep:${input.sweepId}` },
      },
      select: {
        id: true,
        name: true,
        number: true,
        status: true,
        createdAt: true,
        config: true,
        tags: true,
      },
      orderBy: { createdAt: "asc" },
    });

    // An unknown sweep id is a 404-ish empty, not an error — a user can land
    // here from a stale link after the runs were deleted.
    if (runs.length === 0) {
      return null;
    }

    // Every run in a sweep carries the same block; take the first that has one.
    // Migrated runs keep it under `wandb`, native ones at `config.sweep`.
    let meta: SweepMeta = {};
    for (const run of runs) {
      const config = (run.config as Record<string, unknown> | null) ?? {};
      const sweep =
        (config.wandb as Record<string, unknown> | undefined)?.sweep ??
        config.sweep;
      if (sweep) {
        meta = parseSweepBlock(sweep);
        break;
      }
    }

    // Scalar config only: `wandb` is a nested bookkeeping block, not a knob.
    const flatConfigs = runs.map((run) => {
      const config = (run.config as Record<string, unknown> | null) ?? {};
      return Object.fromEntries(
        Object.entries(config).filter(
          ([, value]) => value !== null && typeof value !== "object",
        ),
      );
    });

    const sweptKeys = inferSweptKeys(flatConfigs, meta.parameters);

    // Metrics these runs actually logged, so the picker can't offer something
    // that would come back empty.
    const runIds = runs.map((run) => run.id);
    const numericRunIds = runIds.map(Number);
    const logRows = await ctx.prisma.runLogs.findMany({
      where: { runId: { in: runIds }, logType: "METRIC" },
      select: { logName: true },
      distinct: ["logName"],
    });
    const availableMetrics = logRows
      .map((row) => row.logName)
      .filter((name) => !name.startsWith(SYS_PREFIX))
      .sort();

    const { name: metricName, source } = resolveMetric(
      input.metric,
      meta.metric?.name,
      availableMetrics,
    );
    const goal = input.goal ?? meta.metric?.goal ?? "minimize";

    // One ClickHouse read for the whole sweep, live from mlop_metrics rather
    // than the summaries table — see queryFinalMetricValues for why.
    let values = new Map<number, number>();
    if (metricName) {
      values = await queryFinalMetricValues(clickhouse, {
        organizationId: input.organizationId,
        projectName: input.projectName,
        logName: metricName,
        runIds: numericRunIds,
      });
    }

    const sweepRuns = runs.map((run, index) => ({
      runId: sqidEncode(run.id),
      name: run.name,
      displayId:
        run.number != null && project.runPrefix
          ? `${project.runPrefix}-${run.number}`
          : null,
      status: String(run.status),
      createdAt: run.createdAt,
      config: flatConfigs[index],
      metricValue: metricName ? (values.get(Number(run.id)) ?? null) : null,
      wandbUrl: wandbUrlOf(run.config),
    }));

    const statusCounts = summarizeStatuses(runs.map((run) => String(run.status)));
    const total = gridTotal(meta.method, meta.parameters);

    // The importance panel may target a different metric from the page. Only
    // pay for a second read when it actually differs.
    const statsMetric =
      input.statsMetric && availableMetrics.includes(input.statsMetric)
        ? input.statsMetric
        : metricName;

    let statsRuns = sweepRuns;
    if (statsMetric && statsMetric !== metricName) {
      const statsValues = await queryFinalMetricValues(clickhouse, {
        organizationId: input.organizationId,
        projectName: input.projectName,
        logName: statsMetric,
        runIds: numericRunIds,
      });
      statsRuns = runs.map((run, index) => ({
        ...sweepRuns[index],
        metricValue: statsValues.get(Number(run.id)) ?? null,
      }));
    }

    // Either the declared/observed sweep axes, or every config key that varies.
    const statsKeys = input.includeAllConfig
      ? inferSweptKeys(flatConfigs)
      : sweptKeys;

    return {
      // Spread the parsed block field by field rather than `...meta`: the block
      // also carries `parameters`, the whole declared search space, which this
      // payload does declare — but only because the search-space panel reads it.
      name: meta.name,
      method: meta.method,
      metric: meta.metric,
      parameters: meta.parameters,
      sweepId: input.sweepId,
      state: deriveState(statusCounts, total),
      statuses: statusCounts,
      gridTotal: total,
      statsMetric,
      paramStats: await cachedParamStats(
        input.organizationId,
        input.projectName,
        input.sweepId,
        statsRuns,
        statsKeys,
      ),
      fromWandb: runs.some((run) => run.tags.includes("import:wandb")),
      sweptKeys,
      availableMetrics,
      resolvedMetric: { name: metricName, goal, source },
      runs: sweepRuns,
    };
  });

/** The original wandb run's URL, which the migration stores per run. */
function wandbUrlOf(config: unknown): string | null {
  const wandb = (config as Record<string, unknown> | null)?.wandb;
  const url = (wandb as Record<string, unknown> | undefined)?.url;
  return typeof url === "string" ? url : null;
}

/** Explicit request → declared objective → first shared non-system metric. */
function resolveMetric(
  requested: string | undefined,
  declared: string | undefined,
  available: string[],
): { name: string | null; source: SweepDetail["resolvedMetric"]["source"] } {
  if (requested && available.includes(requested)) {
    return { name: requested, source: "requested" };
  }
  if (declared && available.includes(declared)) {
    return { name: declared, source: "sweep-config" };
  }
  if (available.length > 0) {
    return { name: available[0], source: "inferred" };
  }
  return { name: null, source: "none" };
}
