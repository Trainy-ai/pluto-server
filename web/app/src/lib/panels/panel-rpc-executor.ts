// Python Panels — pure RPC execution core (no React, no tRPC client
// import → directly unit-testable). The host hook (use-panel-bridge)
// injects the real `execute` that resolves the allowlist's trpcPath
// against the tRPC options proxy and fetches through the query cache.

import {
  buildPanelBridgeRequest,
  type PanelHostContext,
} from "./panel-bridge-allowlist";
import type { PanelRpcError } from "./panel-bridge-protocol";

/** Max concurrently executing RPCs per panel instance. */
const DEFAULT_MAX_IN_FLIGHT = 4;
/** Per-RPC execution timeout (parent side; the Python SDK's own is 60s). */
const DEFAULT_TIMEOUT_MS = 30_000;

export type PanelRpcResult =
  | { ok: true; data: unknown }
  | { ok: false; error: PanelRpcError };

export interface PanelRpcExecutorDeps {
  /** Runs the resolved tRPC query. Injected for unit tests. */
  execute: (trpcPath: string, input: Record<string, unknown>) => Promise<unknown>;
  maxInFlight?: number;
  timeoutMs?: number;
}

/**
 * Make superjson-decoded query results postMessage/JSON-safe: Dates →
 * ISO strings (via toJSON), BigInt → string, undefined → null.
 */
export function toJsonSafe(value: unknown): unknown {
  if (value === undefined) {
    return null;
  }
  return JSON.parse(
    JSON.stringify(value, (_key, v: unknown) =>
      typeof v === "bigint" ? v.toString() : v,
    ),
  ) as unknown;
}

class RpcTimeoutError extends Error {}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new RpcTimeoutError(`timed out after ${ms}ms`)),
      ms,
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

/**
 * Allowlist-validating RPC runner with an in-flight cap and timeout.
 * Every result is JSON-normalized before it can reach postMessage.
 */
export function createPanelRpcExecutor(deps: PanelRpcExecutorDeps) {
  const maxInFlight = deps.maxInFlight ?? DEFAULT_MAX_IN_FLIGHT;
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let inFlight = 0;
  const waiters: Array<() => void> = [];

  const acquire = () =>
    new Promise<void>((resolve) => {
      if (inFlight < maxInFlight) {
        inFlight += 1;
        resolve();
      } else {
        waiters.push(() => {
          inFlight += 1;
          resolve();
        });
      }
    });

  const release = () => {
    inFlight -= 1;
    waiters.shift()?.();
  };

  return async function run(
    method: string,
    params: unknown,
    hostCtx: PanelHostContext,
  ): Promise<PanelRpcResult> {
    const built = buildPanelBridgeRequest(method, params, hostCtx);
    if (!built.ok) {
      return built;
    }
    await acquire();
    try {
      const data = await withTimeout(
        deps.execute(built.trpcPath, built.input),
        timeoutMs,
      );
      return { ok: true, data: toJsonSafe(data) };
    } catch (error) {
      if (error instanceof RpcTimeoutError) {
        return {
          ok: false,
          error: { code: "TIMEOUT", message: `"${method}" ${error.message}` },
        };
      }
      return {
        ok: false,
        error: {
          code: "UPSTREAM",
          message: error instanceof Error ? error.message : String(error),
        },
      };
    } finally {
      release();
    }
  };
}
