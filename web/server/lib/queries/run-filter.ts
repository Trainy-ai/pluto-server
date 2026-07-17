// Compiles a wandb-compatible MongoDB-style run filter into a set of matching
// run IDs. The client (`pluto.query.list_runs(filters=...)`) sends this AST as a
// JSON-encoded `filter` query param on /api/runs/list.
//
// Design: every filter dimension already has a leaf resolver that returns a
// run-ID set (PG columns via Prisma; config.* via run_field_values;
// heartbeat/summary_metrics via ClickHouse). We resolve each leaf to a
// `Set<runId>` and combine bottom-up with set algebra — `$and` = ∩, `$or` = ∪,
// `$not` = scope ∖ set — which is what makes a cross-store `OR` (e.g. status in
// Postgres OR heartbeat in ClickHouse) tractable.
//
// Supported subset (unknown field/operator → FilterError → HTTP 400):
//   boolean:  $and, $or, $not (+ implicit AND of keys within one object)
//   leaf ops: bare value (eq), $ne, $gt/$gte/$lt/$lte, $in/$nin, $regex
//   fields:   state/status, heartbeat_at, created_at/updated_at,
//             name/displayName, tags, config.<key>, summaryMetrics.<key>

import { Prisma, RunStatus } from "@prisma/client";
import { clickhouse } from "../clickhouse";
import {
  queryHeartbeatFilteredRunIds,
  queryMetricFilteredRunIds,
} from "./metric-summaries";
import {
  queryFieldFilteredRunIds,
  type FieldFilter,
} from "../../trpc/routers/runs/procs/list-runs";
import {
  RUN_FILTER_LEAF_OPERATOR_SET,
  isKnownFilterField,
} from "./run-filter-grammar";
import type { prisma as PrismaClient } from "../prisma";

/** Raised on a malformed/unsupported filter; the route maps it to HTTP 400. */
export class FilterError extends Error {}

// Cap the candidate universe a `$not`/`$or` is evaluated against, bounding work
// on huge projects (mirrors the custom-sort candidate cap).
const MAX_FILTER_CANDIDATES = 10_000;

// wandb run states → Pluto RunStatus. Pluto status names are also accepted.
const WANDB_STATE_ALIASES: Record<string, RunStatus> = {
  running: RunStatus.RUNNING,
  finished: RunStatus.COMPLETED,
  completed: RunStatus.COMPLETED,
  failed: RunStatus.FAILED,
  crashed: RunStatus.FAILED,
  killed: RunStatus.TERMINATED,
  terminated: RunStatus.TERMINATED,
  preempted: RunStatus.CANCELLED,
  cancelled: RunStatus.CANCELLED,
  canceled: RunStatus.CANCELLED,
};


type Json = unknown;

export interface CompileCtx {
  prisma: typeof PrismaClient;
  organizationId: string;
  projectId?: bigint;
  projectName?: string;
}

/**
 * Resolve the filter AST to the set of matching run IDs (within org/project
 * scope). The caller applies the result as a Prisma `id: { in: ... }` clause.
 */
export async function compileRunFilter(
  ast: Json,
  ctx: CompileCtx,
): Promise<bigint[]> {
  const compiler = new RunFilterCompiler(ctx);
  const result = await compiler.eval(ast);
  return [...result];
}

class RunFilterCompiler {
  private scope?: Set<bigint>;

  constructor(private ctx: CompileCtx) {}

  async eval(node: Json): Promise<Set<bigint>> {
    if (!isPlainObject(node)) {
      throw new FilterError("filter must be an object");
    }
    const keys = Object.keys(node);
    if (keys.length === 0) {
      // Empty filter ⇒ everything in scope.
      return this.getScope();
    }
    // An object with multiple keys is an implicit AND of each entry.
    if (keys.length > 1) {
      return this.intersect(
        await Promise.all(keys.map((k) => this.eval({ [k]: node[k] }))),
      );
    }

    const key = keys[0];
    const value = node[key];

    if (key === "$and" || key === "$or") {
      if (!Array.isArray(value)) {
        throw new FilterError(`${key} expects an array`);
      }
      const sets = await Promise.all(value.map((child) => this.eval(child)));
      return key === "$and" ? this.intersect(sets) : union(sets);
    }
    if (key === "$not") {
      const inner = await this.eval(value);
      const scope = await this.getScope();
      return new Set([...scope].filter((id) => !inner.has(id)));
    }
    if (key.startsWith("$")) {
      throw new FilterError(`unknown boolean operator: ${key}`);
    }

    return this.evalLeaf(key, value);
  }

  // ---- leaf resolution -------------------------------------------------

  private async evalLeaf(field: string, raw: Json): Promise<Set<bigint>> {
    // Grammar gate: reject unknown fields up front against the canonical
    // vocabulary (run-filter-grammar.ts). The dispatch below covers every field
    // the grammar admits.
    if (!isKnownFilterField(field)) {
      throw new FilterError(`unknown filter field: ${field}`);
    }
    const ops = normalizeLeaf(raw); // { $eq } | { $gt, ... } etc.

    if (field === "state" || field === "status") {
      return this.statusLeaf(ops);
    }
    if (field === "heartbeat_at" || field === "heartbeatAt") {
      return this.heartbeatLeaf(ops);
    }
    if (
      field === "created_at" ||
      field === "createdAt" ||
      field === "updated_at" ||
      field === "updatedAt"
    ) {
      const col = field.startsWith("created") ? "createdAt" : "updatedAt";
      return this.timestampLeaf(col, ops);
    }
    if (field === "name" || field === "displayName" || field === "display_name") {
      return this.nameLeaf(ops);
    }
    if (field === "tags") {
      return this.tagsLeaf(ops);
    }
    if (field.startsWith("config.") || field.startsWith("systemMetadata.")) {
      return this.fieldValueLeaf(field, ops);
    }
    if (
      field.startsWith("summaryMetrics.") ||
      field.startsWith("summary_metrics.")
    ) {
      return this.metricLeaf(field, ops);
    }
    throw new FilterError(`unknown filter field: ${field}`);
  }

  private async statusLeaf(ops: LeafOps): Promise<Set<bigint>> {
    const toStatus = (v: Json): RunStatus => {
      const s = String(v);
      const mapped = WANDB_STATE_ALIASES[s.toLowerCase()] ?? (s in RunStatus ? (s as RunStatus) : undefined);
      if (!mapped) throw new FilterError(`unknown run state: ${s}`);
      return mapped;
    };
    let where: Prisma.RunsWhereInput;
    if ("$in" in ops) where = { status: { in: asArray(ops.$in).map(toStatus) } };
    else if ("$nin" in ops) where = { status: { notIn: asArray(ops.$nin).map(toStatus) } };
    else if ("$ne" in ops) where = { status: { not: toStatus(ops.$ne) } };
    else if ("$eq" in ops) where = { status: toStatus(ops.$eq) };
    else throw new FilterError(`unsupported operator for status: ${opName(ops)}`);
    return this.prismaLeaf(where);
  }

  private async timestampLeaf(
    col: "createdAt" | "updatedAt",
    ops: LeafOps,
  ): Promise<Set<bigint>> {
    const f: Prisma.DateTimeFilter = {};
    if ("$eq" in ops) f.equals = new Date(String(ops.$eq));
    if ("$gt" in ops) f.gt = new Date(String(ops.$gt));
    if ("$gte" in ops) f.gte = new Date(String(ops.$gte));
    if ("$lt" in ops) f.lt = new Date(String(ops.$lt));
    if ("$lte" in ops) f.lte = new Date(String(ops.$lte));
    if (Object.keys(f).length === 0) {
      throw new FilterError(`unsupported operator for ${col}: ${opName(ops)}`);
    }
    return this.prismaLeaf({ [col]: f });
  }

  private async nameLeaf(ops: LeafOps): Promise<Set<bigint>> {
    let where: Prisma.RunsWhereInput;
    if ("$eq" in ops) where = { name: { equals: String(ops.$eq) } };
    else if ("$ne" in ops) where = { name: { not: String(ops.$ne) } };
    else if ("$regex" in ops) where = { name: { contains: String(ops.$regex), mode: "insensitive" } };
    else throw new FilterError(`unsupported operator for name: ${opName(ops)}`);
    return this.prismaLeaf(where);
  }

  private async tagsLeaf(ops: LeafOps): Promise<Set<bigint>> {
    let where: Prisma.RunsWhereInput;
    if ("$in" in ops) where = { tags: { hasSome: asArray(ops.$in).map(String) } };
    else if ("$eq" in ops) where = { tags: { has: String(ops.$eq) } };
    else throw new FilterError(`unsupported operator for tags: ${opName(ops)}`);
    return this.prismaLeaf(where);
  }

  private async fieldValueLeaf(field: string, ops: LeafOps): Promise<Set<bigint>> {
    const source: "config" | "systemMetadata" = field.startsWith("config.")
      ? "config"
      : "systemMetadata";
    const key = field.slice(source.length + 1);
    if (!key) throw new FilterError(`empty key in field: ${field}`);
    // A leaf may carry more than one operator (e.g. a two-bound range
    // `{$gt, $lt}`); emit one term per operator and let queryFieldFilteredRunIds
    // AND them together (implicit-AND, matching Mongo/wandb semantics).
    const terms = toFieldFilterTerms(source, key, ops);
    const ids = await queryFieldFilteredRunIds(this.ctx.prisma, {
      organizationId: this.ctx.organizationId,
      ...(this.ctx.projectId != null ? { projectId: this.ctx.projectId } : {}),
      fieldFilters: terms,
    });
    return new Set(ids);
  }

  private async heartbeatLeaf(ops: LeafOps): Promise<Set<bigint>> {
    this.requireProject("heartbeat_at");
    let after: string | undefined;
    let before: string | undefined;
    if ("$gte" in ops || "$gt" in ops) after = String(ops.$gte ?? ops.$gt);
    if ("$lte" in ops || "$lt" in ops) before = String(ops.$lte ?? ops.$lt);
    if (after == null && before == null) {
      throw new FilterError(`heartbeat_at needs a $gt/$gte/$lt/$lte bound`);
    }
    const ids = await queryHeartbeatFilteredRunIds(clickhouse, {
      organizationId: this.ctx.organizationId,
      projectName: this.ctx.projectName!,
      ...(after != null ? { after } : {}),
      ...(before != null ? { before } : {}),
    });
    return new Set(ids.map((n) => BigInt(n)));
  }

  private async metricLeaf(field: string, ops: LeafOps): Promise<Set<bigint>> {
    this.requireProject("summaryMetrics.*");
    const key = field.slice(field.indexOf(".") + 1);
    if (!key) throw new FilterError(`empty metric name in field: ${field}`);
    // One metric filter per operator so a two-bound range `{$gt, $lt}` INTERSECTs
    // both bounds (queryMetricFilteredRunIds AND-s via INTERSECT) rather than
    // honoring only the first.
    const comparisons = toComparisonOps(ops, "summaryMetrics");
    const ids = await queryMetricFilteredRunIds(clickhouse, {
      organizationId: this.ctx.organizationId,
      projectName: this.ctx.projectName!,
      metricFilters: comparisons.map(({ operator, values }) => ({
        logName: key,
        aggregation: "LAST",
        operator,
        values,
      })),
    });
    return new Set(ids.map((n) => BigInt(n)));
  }

  // ---- helpers ---------------------------------------------------------

  /** Run a Prisma `where` (AND-ed with org/project scope) → matching id set. */
  private async prismaLeaf(where: Prisma.RunsWhereInput): Promise<Set<bigint>> {
    const rows = await this.ctx.prisma.runs.findMany({
      where: { ...this.baseWhere(), ...where },
      select: { id: true },
      take: MAX_FILTER_CANDIDATES,
    });
    return new Set(rows.map((r) => r.id));
  }

  private baseWhere(): Prisma.RunsWhereInput {
    return {
      organizationId: this.ctx.organizationId,
      ...(this.ctx.projectId != null ? { projectId: this.ctx.projectId } : {}),
    };
  }

  /** Capped candidate universe for `$not` / empty filters. Memoized. */
  private async getScope(): Promise<Set<bigint>> {
    if (!this.scope) {
      const rows = await this.ctx.prisma.runs.findMany({
        where: this.baseWhere(),
        select: { id: true },
        take: MAX_FILTER_CANDIDATES,
      });
      this.scope = new Set(rows.map((r) => r.id));
    }
    return this.scope;
  }

  private intersect(sets: Set<bigint>[]): Set<bigint> {
    if (sets.length === 0) return new Set();
    sets.sort((a, b) => a.size - b.size);
    let acc = sets[0];
    for (let i = 1; i < sets.length; i++) {
      acc = new Set([...acc].filter((id) => sets[i].has(id)));
    }
    return acc;
  }

  private requireProject(field: string): void {
    if (!this.ctx.projectName) {
      throw new FilterError(`filtering on ${field} requires projectName`);
    }
  }
}

// ---- pure helpers ------------------------------------------------------

type LeafOps = Record<string, Json>;

function isPlainObject(v: Json): v is Record<string, Json> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Normalize a leaf value to an ops object: bare value ⇒ {$eq}. */
function normalizeLeaf(raw: Json): LeafOps {
  if (isPlainObject(raw) && Object.keys(raw).some((k) => k.startsWith("$"))) {
    for (const k of Object.keys(raw)) {
      if (!RUN_FILTER_LEAF_OPERATOR_SET.has(k)) {
        throw new FilterError(`unknown leaf operator: ${k}`);
      }
    }
    return raw;
  }
  return { $eq: raw };
}

function asArray(v: Json): Json[] {
  return Array.isArray(v) ? v : [v];
}

function opName(ops: LeafOps): string {
  return Object.keys(ops).join(",");
}

function union(sets: Set<bigint>[]): Set<bigint> {
  const out = new Set<bigint>();
  for (const s of sets) for (const id of s) out.add(id);
  return out;
}

/**
 * MongoDB leaf ops → run_field_values term(s). Returns ONE term per operator
 * present so a multi-operator leaf (e.g. a two-bound range `{$gt, $lt}`) AND-s
 * every bound instead of silently honoring only the first — the callers
 * combine the returned terms with AND. Exact `>`/`>=`/`<`/`<=` bounds are kept
 * (a single inclusive `is between` would turn `$gt`/`$lt` into `>=`/`<=`).
 */
function toFieldFilterTerms(
  source: "config" | "systemMetadata",
  key: string,
  ops: LeafOps,
): FieldFilter[] {
  const terms: FieldFilter[] = [];
  // Explicit literal operators so they narrow to the FieldFilter operator enum.
  if ("$gt" in ops) terms.push({ source, key, dataType: "number", operator: ">", values: [Number(ops.$gt)] });
  if ("$gte" in ops) terms.push({ source, key, dataType: "number", operator: ">=", values: [Number(ops.$gte)] });
  if ("$lt" in ops) terms.push({ source, key, dataType: "number", operator: "<", values: [Number(ops.$lt)] });
  if ("$lte" in ops) terms.push({ source, key, dataType: "number", operator: "<=", values: [Number(ops.$lte)] });
  if ("$regex" in ops) terms.push({ source, key, dataType: "text", operator: "regex", values: [String(ops.$regex)] });
  if ("$in" in ops) terms.push({ source, key, dataType: "option", operator: "is any of", values: asArray(ops.$in) });
  if ("$nin" in ops) terms.push({ source, key, dataType: "option", operator: "is none of", values: asArray(ops.$nin) });
  // $eq/$ne share an equality shape that picks number-vs-text by the value.
  const pushEquality = (mop: "$eq" | "$ne", operator: "is" | "is not") => {
    if (!(mop in ops)) return;
    const v = ops[mop];
    terms.push(
      numberish(v)
        ? { source, key, dataType: "number", operator, values: [Number(v)] }
        : { source, key, dataType: "text", operator, values: [String(v)] },
    );
  };
  pushEquality("$ne", "is not");
  pushEquality("$eq", "is");
  if (terms.length === 0) {
    throw new FilterError(`unsupported operator for ${source}.${key}: ${opName(ops)}`);
  }
  return terms;
}

/**
 * MongoDB comparison ops → metric-summary (operator, values) pairs. Returns one
 * pair per operator present so a multi-operator leaf (two-bound range) yields
 * every bound; the caller AND-s them (INTERSECT).
 */
function toComparisonOps(
  ops: LeafOps,
  fieldLabel: string,
): { operator: string; values: unknown[] }[] {
  const map: Record<string, string> = {
    $eq: "is",
    $ne: "is not",
    $gt: ">",
    $gte: ">=",
    $lt: "<",
    $lte: "<=",
  };
  const out: { operator: string; values: unknown[] }[] = [];
  for (const [mop, op] of Object.entries(map)) {
    if (mop in ops) out.push({ operator: op, values: [ops[mop]] });
  }
  if (out.length === 0) {
    throw new FilterError(`unsupported operator for ${fieldLabel}: ${opName(ops)}`);
  }
  return out;
}

function numberish(v: Json): boolean {
  return typeof v === "number" || (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v)));
}
