// Python Panels — bridge method allowlist.
//
// Pure, unit-testable module (no React, no tRPC client import). Maps
// each bridge RPC method name to:
//   • the tRPC procedure it is allowed to call (`trpcPath`, exported as
//     DATA so the host hook resolves it against the tRPC client later),
//   • a Zod schema for the panel-supplied params (REJECT semantics: any
//     out-of-bounds value fails with BAD_PARAMS — nothing is silently
//     truncated, so panel authors get deterministic feedback), and
//   • `buildTrpcInput`, which produces the exact input shape the target
//     procedure's Zod schema expects.
//
// SECURITY INVARIANTS:
//   1. `organizationId` and `projectName` in the built input ALWAYS come
//      from the host context — never from panel params. Unknown keys in
//      params (including attempts to inject organizationId/projectName)
//      are stripped by the param schemas before buildTrpcInput runs.
//   2. Only the methods in this table exist. Anything else is
//      FORBIDDEN_METHOD.
//   3. Every mapped procedure is an existing read-only
//      protectedOrgProcedure query — the bridge adds zero new backend
//      surface, and results are only ever data the viewer's own session
//      could already fetch.
//
// Run ids are the SQID-encoded strings used across the frontend/tRPC
// layer (e.g. from `runs.latest`), NOT numeric database ids.

import { z } from "zod";
import type { PanelRpcError } from "./panel-bridge-protocol";

/** Host-side state a panel is scoped to. Never panel-controlled. */
export interface PanelHostContext {
  organizationId: string;
  projectName: string;
  /** SQID-encoded ids of the runs currently selected in the host UI. */
  selectedRunIds: string[];
}

export interface PanelBridgeMethodDef {
  /** Dot path of the tRPC procedure, e.g. "runs.data.logs". */
  trpcPath: string;
  /** Validates (and strips unknown keys from) panel-supplied params. */
  paramsSchema: z.ZodTypeAny;
  /**
   * Context-dependent validation the param schema can't express (e.g.
   * a default that resolves against host state). Runs after schema
   * parse; a returned error aborts with that error.
   */
  precondition?(
    params: unknown,
    hostCtx: PanelHostContext,
  ): PanelRpcError | null;
  /** Builds the exact tRPC input from PARSED params + host context. */
  buildTrpcInput(
    params: unknown,
    hostCtx: PanelHostContext,
  ): Record<string, unknown>;
}

function defineMethod<S extends z.ZodTypeAny>(def: {
  trpcPath: string;
  paramsSchema: S;
  precondition?: (
    params: z.output<S>,
    hostCtx: PanelHostContext,
  ) => PanelRpcError | null;
  buildTrpcInput: (
    params: z.output<S>,
    hostCtx: PanelHostContext,
  ) => Record<string, unknown>;
}): PanelBridgeMethodDef {
  return def as PanelBridgeMethodDef;
}

/**
 * Shared precondition for methods whose `runIds` defaults to the host's
 * selected runs: with no runs selected and none passed, the mapped
 * procedure would reject the empty list anyway — fail here with a
 * message the panel author can act on.
 */
function requireResolvableRunIds(
  params: { runIds?: string[] },
  hostCtx: PanelHostContext,
): PanelRpcError | null {
  if (params.runIds === undefined && hostCtx.selectedRunIds.length === 0) {
    return {
      code: "BAD_PARAMS",
      message:
        'No runs to query: "runIds" was omitted and no runs are selected in the dashboard. Select runs or pass runIds explicitly.',
    };
  }
  return null;
}

const aggregationSchema = z.enum(["LAST", "AVG", "MIN", "MAX", "VARIANCE"]);

/** Max runs per getMetrics call (mirrors chart widgets' practical cap). */
const MAX_METRIC_RUNS = 50;
/** Max runs per getMetricSummaries / getRuns (matches proc limits). */
const MAX_SUMMARY_RUNS = 200;

export const PANEL_BRIDGE_METHODS = {
  /** List the project's runs. → runs.latest */
  getRuns: defineMethod({
    trpcPath: "runs.latest",
    paramsSchema: z
      .object({
        limit: z.number().int().min(1).max(MAX_SUMMARY_RUNS).optional(),
      })
      .default({}),
    buildTrpcInput: (params, hostCtx) => ({
      organizationId: hostCtx.organizationId,
      projectName: hostCtx.projectName,
      limit: params.limit ?? 50,
    }),
  }),

  /** Discover metric names. → runs.distinctMetricNames */
  getMetricNames: defineMethod({
    trpcPath: "runs.distinctMetricNames",
    paramsSchema: z
      .object({
        search: z.string().max(500).optional(),
      })
      .default({}),
    buildTrpcInput: (params, hostCtx) => ({
      organizationId: hostCtx.organizationId,
      projectName: hostCtx.projectName,
      ...(params.search !== undefined ? { search: params.search } : {}),
    }),
  }),

  /** Discover file-type log names. → runs.distinctFileLogNames */
  getFileLogNames: defineMethod({
    trpcPath: "runs.distinctFileLogNames",
    paramsSchema: z
      .object({
        search: z.string().max(500).optional(),
      })
      .default({}),
    buildTrpcInput: (params, hostCtx) => ({
      organizationId: hostCtx.organizationId,
      projectName: hostCtx.projectName,
      ...(params.search !== undefined ? { search: params.search } : {}),
    }),
  }),

  /**
   * Bucketed metric series. → runs.data.graphMultiMetricBatchBucketed
   * runIds default to the host's selected runs. includeLineage/preview
   * are deliberately NOT exposed.
   */
  getMetrics: defineMethod({
    trpcPath: "runs.data.graphMultiMetricBatchBucketed",
    paramsSchema: z.object({
      metrics: z.array(z.string().min(1)).min(1).max(50),
      runIds: z.array(z.string().min(1)).min(1).max(MAX_METRIC_RUNS).optional(),
      buckets: z.number().int().min(10).max(2000).optional(),
    }),
    precondition: requireResolvableRunIds,
    buildTrpcInput: (params, hostCtx) => ({
      organizationId: hostCtx.organizationId,
      projectName: hostCtx.projectName,
      runIds: params.runIds ?? hostCtx.selectedRunIds.slice(0, MAX_METRIC_RUNS),
      logNames: params.metrics,
      ...(params.buckets !== undefined ? { buckets: params.buckets } : {}),
    }),
  }),

  /** Aggregated per-run metric values. → runs.metricSummaries */
  getMetricSummaries: defineMethod({
    trpcPath: "runs.metricSummaries",
    paramsSchema: z.object({
      metrics: z.array(z.string().min(1)).min(1).max(200),
      aggregation: aggregationSchema.default("LAST"),
      runIds: z
        .array(z.string().min(1))
        .min(1)
        .max(MAX_SUMMARY_RUNS)
        .optional(),
    }),
    precondition: requireResolvableRunIds,
    buildTrpcInput: (params, hostCtx) => ({
      organizationId: hostCtx.organizationId,
      projectName: hostCtx.projectName,
      runIds:
        params.runIds ?? hostCtx.selectedRunIds.slice(0, MAX_SUMMARY_RUNS),
      metrics: params.metrics.map((logName) => ({
        logName,
        aggregation: params.aggregation,
      })),
    }),
  }),

  /** Latest value of every metric for one run. → runs.data.metricValues */
  getMetricValues: defineMethod({
    trpcPath: "runs.data.metricValues",
    paramsSchema: z.object({
      runId: z.string().min(1),
    }),
    buildTrpcInput: (params, hostCtx) => ({
      organizationId: hostCtx.organizationId,
      projectName: hostCtx.projectName,
      runId: params.runId,
    }),
  }),

  /** Console/debug logs for one run. → runs.data.logs */
  getLogs: defineMethod({
    trpcPath: "runs.data.logs",
    paramsSchema: z.object({
      runId: z.string().min(1),
      logType: z.string().min(1).max(100).optional(),
    }),
    buildTrpcInput: (params, hostCtx) => ({
      organizationId: hostCtx.organizationId,
      projectName: hostCtx.projectName,
      runId: params.runId,
      ...(params.logType !== undefined ? { logType: params.logType } : {}),
    }),
  }),

  /** Presigned URL for one logged file. → runs.data.fileUrl */
  getFileUrl: defineMethod({
    trpcPath: "runs.data.fileUrl",
    paramsSchema: z.object({
      runId: z.string().min(1),
      logName: z.string().min(1).max(1024),
      fileName: z.string().min(1).max(1024),
    }),
    buildTrpcInput: (params, hostCtx) => ({
      organizationId: hostCtx.organizationId,
      projectName: hostCtx.projectName,
      runId: params.runId,
      logName: params.logName,
      fileName: params.fileName,
    }),
  }),
} satisfies Record<string, PanelBridgeMethodDef>;

export type PanelBridgeMethodName = keyof typeof PANEL_BRIDGE_METHODS;

export function isPanelBridgeMethod(
  method: string,
): method is PanelBridgeMethodName {
  return Object.prototype.hasOwnProperty.call(PANEL_BRIDGE_METHODS, method);
}

export type PanelBridgeBuildResult =
  | { ok: true; trpcPath: string; input: Record<string, unknown> }
  | { ok: false; error: PanelRpcError };

/**
 * Resolve a bridge RPC (method + raw panel params) into the tRPC call
 * the host is allowed to execute. Deterministic REJECT semantics:
 * unknown method → FORBIDDEN_METHOD; params outside the documented
 * bounds → BAD_PARAMS (never truncated). On success, `input` is exactly
 * what the target procedure's input schema expects, with
 * organizationId/projectName taken from `hostCtx` unconditionally.
 */
export function buildPanelBridgeRequest(
  method: string,
  params: unknown,
  hostCtx: PanelHostContext,
): PanelBridgeBuildResult {
  if (!isPanelBridgeMethod(method)) {
    return {
      ok: false,
      error: {
        code: "FORBIDDEN_METHOD",
        message: `Method "${method}" is not allowed. Allowed methods: ${Object.keys(PANEL_BRIDGE_METHODS).join(", ")}`,
      },
    };
  }

  const def = PANEL_BRIDGE_METHODS[method];
  const parsed = def.paramsSchema.safeParse(params);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue?.path?.length ? ` at "${issue.path.join(".")}"` : "";
    return {
      ok: false,
      error: {
        code: "BAD_PARAMS",
        message: `Invalid params for "${method}"${where}: ${issue?.message ?? "invalid input"}`,
      },
    };
  }

  const preconditionError = def.precondition?.(parsed.data, hostCtx);
  if (preconditionError) {
    return { ok: false, error: preconditionError };
  }

  return {
    ok: true,
    trpcPath: def.trpcPath,
    input: def.buildTrpcInput(parsed.data, hostCtx),
  };
}
