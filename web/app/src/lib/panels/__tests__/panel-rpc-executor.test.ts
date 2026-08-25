import { describe, expect, it, vi } from "vitest";
import type { PanelHostContext } from "../panel-bridge-allowlist";
import { createPanelRpcExecutor, toJsonSafe } from "../panel-rpc-executor";

const hostCtx: PanelHostContext = {
  organizationId: "org-1",
  projectName: "proj-1",
  selectedRunIds: ["run-a", "run-b"],
};

describe("toJsonSafe", () => {
  it("converts Dates to ISO strings (superjson decode → wire format)", () => {
    const date = new Date("2026-01-02T03:04:05.000Z");
    expect(toJsonSafe({ createdAt: date })).toEqual({
      createdAt: "2026-01-02T03:04:05.000Z",
    });
  });

  it("converts BigInt to string and undefined to null", () => {
    expect(toJsonSafe({ id: 123n })).toEqual({ id: "123" });
    expect(toJsonSafe(undefined)).toBeNull();
  });

  it("passes plain JSON data through structurally unchanged", () => {
    const value = { a: [1, null, "x"], b: { c: true } };
    expect(toJsonSafe(value)).toEqual(value);
  });
});

describe("createPanelRpcExecutor", () => {
  it("executes an allowlisted method and JSON-normalizes the result", async () => {
    const execute = vi.fn().mockResolvedValue([
      { id: "run-a", createdAt: new Date("2026-01-01T00:00:00.000Z") },
    ]);
    const run = createPanelRpcExecutor({ execute });

    const result = await run("getRuns", { limit: 5 }, hostCtx);
    expect(result).toEqual({
      ok: true,
      data: [{ id: "run-a", createdAt: "2026-01-01T00:00:00.000Z" }],
    });
    expect(execute).toHaveBeenCalledWith("runs.latest", {
      organizationId: "org-1",
      projectName: "proj-1",
      limit: 5,
    });
  });

  it("forces organizationId/projectName from host context (allowlist integration)", async () => {
    const execute = vi.fn().mockResolvedValue({});
    const run = createPanelRpcExecutor({ execute });

    // Injection attempt: params carry a foreign org/project. The param
    // schemas STRIP unknown keys before buildTrpcInput runs, and the
    // built input always takes org/project from the host context.
    const injected = await run(
      "getMetrics",
      {
        metrics: ["train/loss"],
        organizationId: "attacker-org",
        projectName: "attacker-proj",
      },
      hostCtx,
    );
    expect(injected).toMatchObject({ ok: true });
    expect(execute).toHaveBeenLastCalledWith(
      "runs.data.graphMultiMetricBatchBucketed",
      expect.objectContaining({
        organizationId: "org-1",
        projectName: "proj-1",
        runIds: ["run-a", "run-b"], // defaults to host-selected runs
        logNames: ["train/loss"],
      }),
    );
  });

  it("rejects unknown methods with FORBIDDEN_METHOD without executing", async () => {
    const execute = vi.fn();
    const run = createPanelRpcExecutor({ execute });

    const result = await run("dropTables", {}, hostCtx);
    expect(result).toMatchObject({ ok: false, error: { code: "FORBIDDEN_METHOD" } });
    expect(execute).not.toHaveBeenCalled();
  });

  it("rejects out-of-bounds params with BAD_PARAMS without executing", async () => {
    const execute = vi.fn();
    const run = createPanelRpcExecutor({ execute });

    const result = await run(
      "getMetrics",
      { metrics: ["train/loss"], buckets: 999999 },
      hostCtx,
    );
    expect(result).toMatchObject({ ok: false, error: { code: "BAD_PARAMS" } });
    expect(execute).not.toHaveBeenCalled();
  });

  it("maps upstream failures to UPSTREAM", async () => {
    const execute = vi.fn().mockRejectedValue(new Error("clickhouse exploded"));
    const run = createPanelRpcExecutor({ execute });

    const result = await run("getRuns", {}, hostCtx);
    expect(result).toEqual({
      ok: false,
      error: { code: "UPSTREAM", message: "clickhouse exploded" },
    });
  });

  it("times out slow queries with TIMEOUT", async () => {
    const execute = vi.fn().mockReturnValue(new Promise(() => {})); // never settles
    const run = createPanelRpcExecutor({ execute, timeoutMs: 20 });

    const result = await run("getRuns", {}, hostCtx);
    expect(result).toMatchObject({ ok: false, error: { code: "TIMEOUT" } });
  });

  it("caps concurrent executions at maxInFlight and drains the queue", async () => {
    const resolvers: Array<(v: unknown) => void> = [];
    const execute = vi.fn(
      () => new Promise((resolve) => resolvers.push(resolve)),
    );
    const run = createPanelRpcExecutor({ execute, maxInFlight: 2 });

    const promises = [1, 2, 3, 4].map(() => run("getRuns", {}, hostCtx));
    await Promise.resolve(); // let acquire() settle
    expect(execute).toHaveBeenCalledTimes(2);

    resolvers[0]({ ok: 1 });
    await promises[0];
    expect(execute).toHaveBeenCalledTimes(3);

    resolvers[1]({ ok: 2 });
    resolvers[2]({ ok: 3 });
    await Promise.all([promises[1], promises[2]]);
    expect(execute).toHaveBeenCalledTimes(4);

    resolvers[3]({ ok: 4 });
    const results = await Promise.all(promises);
    expect(results.every((r) => r.ok)).toBe(true);
  });
});
