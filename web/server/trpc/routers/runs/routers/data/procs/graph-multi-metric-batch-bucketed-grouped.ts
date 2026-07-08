import { z } from "zod";
import { protectedOrgProcedure } from "../../../../../../lib/trpc";
import {
  queryRunMetricsGroupedBatchBucketed,
  toColumnar,
  type ColumnarBucketedSeries,
} from "../../../../../../lib/queries";
import {
  buildBatchCacheKey,
  getCached,
  setCached,
  getTTLForStatus,
  CACHE_TTL,
  type RunStatus,
} from "../../../../../../lib/cache";
import {
  applyGroupFiltersToInput,
  loadGroupFilterDataTypes,
} from "../../../../../../lib/group-field";
import {
  buildRunGroupKeyMap,
  fieldValueKeysNeeded,
  type RunForGrouping,
} from "../../../../../../lib/group-run-assignment";
import { sqidDecode } from "../../../../../../lib/sqid";

/** Inner payload: logName → groupPathKey → columnar mean/min/max line.
 *  The pathKey shape is identical to the frontend's runs-table tree
 *  bucket keys, so chart consumers can colour-match without a
 *  translation table. */
type GraphMultiMetricGroupedData = Record<string, Record<string, ColumnarBucketedSeries>>;

/** Wrapped response: buckets + the total distinct group count BEFORE
 *  the `maxGroups` cap was applied. The frontend uses
 *  `totalGroupCount` vs `Object.keys(buckets[logName]).length` to
 *  render the wandb-style "Showing first N of M groups" subtitle
 *  when truncated. (Field is named `buckets` rather than `data` so
 *  it doesn't collide with the tRPC streaming-protocol path key
 *  `result.data` — same-named keys at adjacent tree levels confuse
 *  the JSONL assembler.) */
interface GraphMultiMetricGroupedResponse {
  buckets: GraphMultiMetricGroupedData;
  totalGroupCount: number;
  /** pathKeys (JSON-stringified GroupFilter[]) of groups the maxGroups cap
   *  excluded from the response, sorted by run count DESC then key ASC.
   *  Empty when the cap didn't fire. Capped at 50 entries on the server
   *  to keep the payload small for wide selections; the frontend tooltip
   *  shows the first N and tags overflow as "…+M more". */
  droppedGroupKeys: string[];
  /** Per-logName: pathKeys of groups the cap KEPT but ClickHouse returned
   *  no rows for under that logName — i.e. "in the cap but missing data
   *  for this metric." Distinct from `droppedGroupKeys` (cap-excluded);
   *  the frontend uses this to fill the data-limited branch of the
   *  truncation-banner tooltip. */
  noDataByLogName: Record<string, string[]>;
}

const groupFilterSchema = z.object({
  field: z.string(),
  value: z.string().nullable(),
});

const dateFilterSchema = z.object({
  field: z.enum(["createdAt", "updatedAt", "statusUpdated"]),
  operator: z.enum(["before", "after", "between"]),
  value: z.string().datetime(),
  value2: z.string().datetime().optional(),
});

const fieldFilterSchema = z.object({
  source: z.enum(["config", "systemMetadata"]),
  key: z.string(),
  dataType: z.enum(["text", "number", "date", "option"]),
  operator: z.string(),
  values: z.array(z.any()),
});

const systemFilterSchema = z.object({
  field: z.enum(["name", "status", "tags", "creator.name", "notes"]),
  operator: z.string(),
  values: z.array(z.any()),
});

export const graphMultiMetricBatchBucketedGroupedProcedure = protectedOrgProcedure
  .input(
    z.object({
      projectName: z.string(),
      /** Ordered grouping chain — at least one field. Lines are
       *  aggregated at the deepest (leaf) level. */
      groupBy: z.array(z.string()).min(1).max(5),
      logNames: z.array(z.string()).min(1).max(200),
      buckets: z.number().int().min(10).max(3000).optional(),
      stepMin: z.number().int().nonnegative().optional(),
      stepMax: z.number().int().nonnegative().optional(),
      preview: z.boolean().optional(),
      /** X-axis mode. Default "step" (training step). "time" buckets
       *  by absolute wall-clock time. Relative-time and
       *  custom-metric-x deferred — see PLAN-grouping-v2-charts.md. */
      xAxis: z.enum(["step", "time", "relative-time"]).optional(),
      // Shared toolbar filters — narrow the run universe before grouping
      search: z.string().optional(),
      tags: z.array(z.string()).optional(),
      status: z
        .array(z.enum(["RUNNING", "COMPLETED", "FAILED", "TERMINATED", "CANCELLED"]))
        .optional(),
      dateFilters: z.array(dateFilterSchema).optional(),
      fieldFilters: z.array(fieldFilterSchema).optional(),
      systemFilters: z.array(systemFilterSchema).optional(),
      groupFilters: z.array(groupFilterSchema).optional(),
      /** The set of runs in the user's comparison — what the chart is
       *  actually allowed to aggregate over. Mirrors the flat chart
       *  proc's behaviour: groups are formed ONLY from these runs, so
       *  the "Showing N of M groups" indicator reflects the user's
       *  selection rather than the project's full universe. */
      selectedRunIds: z.array(z.string()).optional(),
      /** Runs the user has toggled off via the visibility eye —
       *  excluded from every group's aggregate so toggling the eye
       *  re-shapes the band/mean. (decision #3 in PLAN-grouping-v2-charts.md) */
      hiddenRunIds: z.array(z.string()).optional(),
      /** Buckets (groups/subgroups/leaves) the user has toggled off
       *  via the eye-icon on a bucket header row. Each entry is the
       *  JSON-stringified bucket trail (`[{field, value}, …]`). A
       *  run is dropped if its leaf pathKey *equals or is prefixed
       *  by* any entry — hiding a parent cascades to every
       *  descendant. Applied BEFORE the maxGroups cap so the cap's
       *  "top N by run count" ranking reflects the post-hide
       *  universe. */
      hiddenGroupPaths: z.array(z.string()).optional(),
      /** Cap on the number of distinct leaf groups rendered. wandb
       *  default. Groups are ranked by (run count DESC, pathKey ASC)
       *  and the top N are kept; the rest are dropped from the
       *  ClickHouse aggregation entirely so the query cost stays
       *  bounded even for projects with thousands of distinct group
       *  values. The frontend renders "Showing first N of M groups"
       *  when this trims anything. */
      maxGroups: z.number().int().positive().max(100).default(10),
    })
  )
  .query(async ({ ctx, input }) => {
    const project = await ctx.prisma.projects.findFirst({
      where: { name: input.projectName, organizationId: input.organizationId },
      select: { id: true },
    });
    if (!project) return { buckets: {}, totalGroupCount: 0, droppedGroupKeys: [], noDataByLogName: {}, __json_safe: true } as unknown as
        GraphMultiMetricGroupedResponse & { __json_safe: true };

    // Translate groupFilters into the regular filter arrays so the run
    // universe respects whatever bucket trail the user is drilled into.
    let filterInput: {
      tags?: string[];
      status?: ("RUNNING" | "COMPLETED" | "FAILED" | "TERMINATED" | "CANCELLED")[];
      fieldFilters?: typeof input.fieldFilters;
      systemFilters?: typeof input.systemFilters;
      tagPrefixExclusions?: string[];
    } = {
      tags: input.tags,
      status: input.status,
      fieldFilters: input.fieldFilters,
      systemFilters: input.systemFilters,
    };
    if (input.groupFilters && input.groupFilters.length > 0) {
      const dt = await loadGroupFilterDataTypes(ctx.prisma, project.id, input.groupFilters);
      filterInput = applyGroupFiltersToInput(filterInput, input.groupFilters, dt);
    }

    // Decode hiddenRunIds SQIDs → numeric for the WHERE NOT IN clause.
    const hiddenNumericIds: bigint[] = [];
    if (input.hiddenRunIds?.length) {
      for (const sqid of input.hiddenRunIds) {
        try {
          const n = sqidDecode(sqid);
          if (n != null) hiddenNumericIds.push(BigInt(n));
        } catch {
          // Skip malformed IDs rather than 400 — the chart should
          // still render for the rest of the runs.
        }
      }
    }

    // Decode selectedRunIds SQIDs → numeric for the WHERE IN clause.
    // When provided, the chart aggregates ONLY over these runs (the
    // user's comparison). When absent or empty, the chart returns
    // an empty payload — grouped mode requires an explicit selection,
    // exactly like the flat chart proc.
    const selectedNumericIds: bigint[] = [];
    if (input.selectedRunIds?.length) {
      for (const sqid of input.selectedRunIds) {
        try {
          const n = sqidDecode(sqid);
          if (n != null) selectedNumericIds.push(BigInt(n));
        } catch {
          // Skip malformed IDs.
        }
      }
    }
    if (!selectedNumericIds.length) {
      return { buckets: {}, totalGroupCount: 0, droppedGroupKeys: [], noDataByLogName: {}, __json_safe: true } as unknown as
        GraphMultiMetricGroupedResponse & { __json_safe: true };
    }

    // Fetch the candidate run universe. We need each run's:
    //   - id, name, status, tags (for system + tag-prefix grouping)
    //   - creator name/email (for system:creator.name)
    //   - any config/systemMetadata field referenced by groupBy
    //     (loaded separately from run_field_values below — keeps the
    //     primary query lean even with many groupBy keys).
    // `id: { in: selectedNumericIds }` narrows the universe to the
    // user's comparison; the toolbar/groupFilters layer adds further
    // constraints on top.
    const runs = await ctx.prisma.runs.findMany({
      where: {
        organizationId: input.organizationId,
        projectId: project.id,
        id: {
          in: selectedNumericIds,
          ...(hiddenNumericIds.length ? { notIn: hiddenNumericIds } : {}),
        },
        ...(filterInput.tags?.length ? { tags: { hasSome: filterInput.tags } } : {}),
        ...(filterInput.status?.length ? { status: { in: filterInput.status } } : {}),
      },
      select: {
        id: true,
        name: true,
        status: true,
        tags: true,
        creator: { select: { name: true, email: true } },
      },
      // Hard cap mirrors the flat chart proc — guards against pathological
      // projects with tens of thousands of runs in one bucket.
      take: 5000,
    });

    if (runs.length === 0) {
      return { buckets: {}, totalGroupCount: 0, droppedGroupKeys: [], noDataByLogName: {}, __json_safe: true } as unknown as
        GraphMultiMetricGroupedResponse & { __json_safe: true };
    }

    // Pre-fetch the (config, systemMetadata) values referenced by
    // groupBy, batched across all runs.
    const neededKeys = fieldValueKeysNeeded(input.groupBy);
    const fieldValuesByRun = new Map<bigint, Map<string, string | null>>();
    if (neededKeys.length > 0) {
      const fvRows = await ctx.prisma.runFieldValue.findMany({
        where: {
          runId: { in: runs.map((r) => r.id) },
          OR: neededKeys.map((k) => ({ source: k.source, key: k.key })),
        },
        select: { runId: true, source: true, key: true, textValue: true, numericValue: true },
      });
      for (const row of fvRows) {
        let m = fieldValuesByRun.get(row.runId);
        if (!m) {
          m = new Map();
          fieldValuesByRun.set(row.runId, m);
        }
        // Stringify to keep the bucket-key shape consistent with the
        // table's tree, which always uses string values (cast in JSON).
        const v =
          row.textValue ??
          (row.numericValue != null ? String(row.numericValue) : null);
        m.set(`${row.source}:${row.key}`, v);
      }
    }

    // Compute runId → leaf bucket pathKey.
    const runsForGrouping: RunForGrouping[] = runs.map((r) => ({
      id: r.id,
      name: r.name,
      status: r.status,
      tags: r.tags,
      creatorName: r.creator?.name ?? null,
      creatorEmail: r.creator?.email ?? null,
    }));
    let runGroupKeyMap = buildRunGroupKeyMap(
      runsForGrouping,
      input.groupBy,
      fieldValuesByRun,
    );

    if (runGroupKeyMap.size === 0) {
      return { buckets: {}, totalGroupCount: 0, droppedGroupKeys: [], noDataByLogName: {}, __json_safe: true } as unknown as
        GraphMultiMetricGroupedResponse & { __json_safe: true };
    }

    // Apply hidden-group filtering BEFORE counting/capping. A run is
    // dropped if its leaf pathKey starts with any hidden trail — so
    // hiding `Group: a` cascades to all (a, *) leaves, hiding
    // `(a, batch_size: 8)` only drops that one leaf, and so on. The
    // post-filter map is what feeds the maxGroups ranking AND
    // totalGroupCount, so the "Showing N of M" indicator reflects
    // the universe the user can actually see.
    if (input.hiddenGroupPaths && input.hiddenGroupPaths.length > 0) {
      // PathKeys are JSON-stringified arrays. A parent's stringified
      // trail is a strict prefix of any descendant's; strip the
      // trailing `]` to form the prefix and check `startsWith(prefix
      // + ",")` for strict descendants, or full equality for the
      // bucket itself. Same logic the frontend `isPathHidden`
      // helper uses, kept in sync.
      const prefixes: string[] = [];
      for (const hidden of input.hiddenGroupPaths) {
        prefixes.push(hidden.slice(0, -1) + ",");
      }
      const hiddenSet = new Set(input.hiddenGroupPaths);
      const kept = new Map<number, string>();
      for (const [runId, groupKey] of runGroupKeyMap) {
        if (hiddenSet.has(groupKey)) continue;
        let prefixed = false;
        for (const prefix of prefixes) {
          if (groupKey.startsWith(prefix)) {
            prefixed = true;
            break;
          }
        }
        if (!prefixed) kept.set(runId, groupKey);
      }
      runGroupKeyMap = kept;
      if (runGroupKeyMap.size === 0) {
        return { buckets: {}, totalGroupCount: 0, droppedGroupKeys: [], noDataByLogName: {}, __json_safe: true } as unknown as
          GraphMultiMetricGroupedResponse & { __json_safe: true };
      }
    }

    // Distinct groups in the (post-hide) universe — this is what the
    // "of M" half of the indicator reports. Computed BEFORE the
    // maxGroups cap so we can report the truncation honestly.
    const totalGroupCount = new Set(runGroupKeyMap.values()).size;

    // pathKeys of groups the cap dropped — surfaced to the frontend so
    // the truncation banner can say *which* groups aren't drawn instead
    // of just *how many*. Populated only when the cap actually fires;
    // empty otherwise. Sorted by run count DESC then key ASC so the
    // first entries are the "next would-have-been-included" — matches
    // user intuition when reading the tooltip ("show me the closest
    // misses first"). Capped at 50 entries to keep the response small
    // on pathologically wide selections.
    let droppedGroupKeys: string[] = [];
    if (totalGroupCount > input.maxGroups) {
      // Rank groups by their run count (most-populated first), with
      // pathKey ASC as the tie-breaker so the result is deterministic
      // across requests. Take the top N and drop the rest from the
      // (runId → key) assignment so ClickHouse never aggregates over
      // them — that's the entire point of this cap.
      const runCountByGroup = new Map<string, number>();
      for (const groupKey of runGroupKeyMap.values()) {
        runCountByGroup.set(groupKey, (runCountByGroup.get(groupKey) ?? 0) + 1);
      }
      const sorted = Array.from(runCountByGroup.entries()).sort(
        (a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0]),
      );
      const keep = new Set(sorted.slice(0, input.maxGroups).map(([k]) => k));
      const filtered = new Map<number, string>();
      for (const [runId, groupKey] of runGroupKeyMap) {
        if (keep.has(groupKey)) filtered.set(runId, groupKey);
      }
      runGroupKeyMap = filtered;
      droppedGroupKeys = sorted
        .slice(input.maxGroups, input.maxGroups + 50)
        .map(([k]) => k);
    }

    const numericRunIds = Array.from(runGroupKeyMap.keys()).sort((a, b) => a - b);

    // ---- Per-group caching ----
    // OLD: single cache key bundling EVERY group's runId→groupKey
    // assignment. Adding/removing any run busts the entry, forcing a
    // full re-aggregation of every group on every selection click.
    //
    // NEW: each group has its own cache entry, keyed only by THAT
    // group's runIds + invariants. When you click "Select Group:a"
    // (adds runs to Group:a only), Group:a's key changes but
    // Group:b/c/d/etc' keys are unchanged → they return from cache
    // in ~1ms. Only Group:a hits ClickHouse.
    //
    // Cold load is unchanged: the SAME ClickHouse query runs once for
    // every group together (we collect cache misses and pass a subset
    // map covering only missing groups; on cold load, that subset is
    // every group).
    //
    // Invert runGroupKeyMap → groupKey → runIds[] so we can iterate
    // per group and build per-group cache keys.
    const runsByGroup = new Map<string, number[]>();
    for (const [runId, groupKey] of runGroupKeyMap) {
      const arr = runsByGroup.get(groupKey);
      if (arr) arr.push(runId);
      else runsByGroup.set(groupKey, [runId]);
    }
    for (const arr of runsByGroup.values()) arr.sort((a, b) => a - b);

    // Map runId → status so we can compute per-group TTL (worst case
    // among the group's runs — one RUNNING member shortens its entry).
    const runStatusByNumericId = new Map<number, string>();
    for (const r of runs) {
      runStatusByNumericId.set(Number(r.id), r.status);
    }

    // Shared cache-key fragments — anything that's NOT specific to a
    // single group sits up here and gets re-used per group below.
    const cacheProcedure =
      input.preview || (input.stepMin !== undefined && input.stepMax !== undefined)
        ? "graphMultiMetricBatchBucketedGrouped"
        : "graphMultiMetricBatchBucketedGroupedFull";
    const sharedKeyFragments = {
      groupBy: input.groupBy.join("|"),
      organizationId: input.organizationId,
      projectName: input.projectName,
      logNames: input.logNames as unknown as string[],
      buckets: input.buckets ?? 0,
      stepMin: input.stepMin ?? -1,
      stepMax: input.stepMax ?? -1,
      preview: input.preview ?? false,
      xAxis: input.xAxis ?? "step",
      maxGroups: input.maxGroups,
    };

    // Per-group cache check. Hits populate `cachedByGroup`; misses
    // accumulate into `missingRunGroupKeyMap` for a SINGLE
    // ClickHouse query (preserves cold-load latency vs N queries).
    const cacheKeyByGroup = new Map<string, string>();
    const cachedByGroup = new Map<string, Record<string, ColumnarBucketedSeries>>();
    const missingRunGroupKeyMap = new Map<number, string>();
    for (const [groupKey, runIdsInGroup] of runsByGroup) {
      const key = buildBatchCacheKey(cacheProcedure, {
        ...sharedKeyFragments,
        // Group identity + ONLY its own runs → adding a run to a
        // DIFFERENT group doesn't change THIS group's key.
        groupKey,
        runIds: runIdsInGroup,
      });
      cacheKeyByGroup.set(groupKey, key);
      const cached = await getCached<Record<string, ColumnarBucketedSeries>>(key);
      if (cached) {
        cachedByGroup.set(groupKey, cached);
      } else {
        // Add all of this group's runs to the missing map so the
        // single CH query below covers them.
        for (const runId of runIdsInGroup) {
          missingRunGroupKeyMap.set(runId, groupKey);
        }
      }
    }

    // Fire ONE ClickHouse query for the union of missing groups'
    // runs. If every group hit cache, skip the call entirely.
    let freshByGroup: Map<string, Record<string, ColumnarBucketedSeries>> = new Map();
    if (missingRunGroupKeyMap.size > 0) {
      const grouped = await queryRunMetricsGroupedBatchBucketed(ctx.clickhouse, {
        organizationId: input.organizationId,
        projectName: input.projectName,
        runGroupKeyMap: missingRunGroupKeyMap,
        logNames: input.logNames,
        buckets: input.buckets,
        stepMin: input.stepMin,
        stepMax: input.stepMax,
        preview: input.preview,
        xAxis: input.xAxis,
      });
      // Pivot CH's `{logName: {groupKey: points}}` shape into
      // `{groupKey: {logName: columnar}}` so we can write one cache
      // entry per group below.
      for (const [logName, byGroup] of Object.entries(grouped)) {
        for (const [groupKey, points] of Object.entries(byGroup)) {
          let perLog = freshByGroup.get(groupKey);
          if (!perLog) {
            perLog = {};
            freshByGroup.set(groupKey, perLog);
          }
          perLog[logName] = toColumnar(points);
        }
      }
      // Write each missing group's result back into cache. TTL is the
      // worst-case status across THAT group's runs (RUNNING shortens).
      // Dedupe group keys we'll write so we don't double-call setCached.
      const writtenGroups = new Set<string>();
      for (const groupKey of missingRunGroupKeyMap.values()) {
        if (writtenGroups.has(groupKey)) continue;
        writtenGroups.add(groupKey);
        const key = cacheKeyByGroup.get(groupKey)!;
        const value = freshByGroup.get(groupKey) ?? {};
        // TTL = MIN of getTTLForStatus over THIS group's runs (a
        // single RUNNING run shortens the cache lifetime to 30s).
        const runIdsInGroup = runsByGroup.get(groupKey) ?? [];
        let ttlMs: number = CACHE_TTL.COMPLETED;
        for (const runId of runIdsInGroup) {
          const status = runStatusByNumericId.get(runId) ?? "RUNNING";
          ttlMs = Math.min(ttlMs, getTTLForStatus(status as RunStatus));
        }
        await setCached(key, value, ttlMs);
      }
    }

    // Merge cached + fresh into the final {logName: {groupKey: columnar}}
    // shape the response wraps. Same shape as before; consumers
    // unchanged.
    const buckets: GraphMultiMetricGroupedData = {};
    const allGroupKeys = new Set<string>([
      ...cachedByGroup.keys(),
      ...freshByGroup.keys(),
    ]);
    for (const groupKey of allGroupKeys) {
      const perLog =
        freshByGroup.get(groupKey) ?? cachedByGroup.get(groupKey) ?? {};
      for (const [logName, columnar] of Object.entries(perLog)) {
        let dest = buckets[logName];
        if (!dest) {
          dest = {};
          buckets[logName] = dest;
        }
        dest[groupKey] = columnar;
      }
    }

    // Per-metric "in the cap but missing data" set: groups the cap KEPT
    // (i.e. ClickHouse was asked about them) but didn't return rows for
    // this specific logName. Lets the frontend tooltip name *which*
    // groups dropped off the chart for the data-availability reason as
    // opposed to the cap reason — distinct from `droppedGroupKeys`,
    // which lists groups the cap excluded outright. Same pathKey shape
    // as droppedGroupKeys so the frontend can `labelForPath()` both.
    const noDataByLogName: Record<string, string[]> = {};
    const keptGroupKeys = Array.from(runsByGroup.keys());
    for (const ln of input.logNames) {
      const presentForLogName = new Set(Object.keys(buckets[ln] ?? {}));
      const missing = keptGroupKeys.filter((k) => !presentForLogName.has(k));
      if (missing.length > 0) noDataByLogName[ln] = missing;
    }

    return { buckets, totalGroupCount, droppedGroupKeys, noDataByLogName, __json_safe: true } as unknown as
      GraphMultiMetricGroupedResponse & { __json_safe: true };
  });
