import { describe, it, expect } from "vitest";
import {
  PANEL_BRIDGE_METHODS,
  buildPanelBridgeRequest,
  isPanelBridgeMethod,
  type PanelHostContext,
} from "../panel-bridge-allowlist";

const hostCtx: PanelHostContext = {
  organizationId: "org_host",
  projectName: "host-project",
  selectedRunIds: ["run-a", "run-b", "run-c"],
};

function expectOk(method: string, params: unknown) {
  const res = buildPanelBridgeRequest(method, params, hostCtx);
  expect(res.ok).toBe(true);
  if (!res.ok) {
    throw new Error("unreachable");
  }
  return res;
}

function expectError(method: string, params: unknown, code: string) {
  const res = buildPanelBridgeRequest(method, params, hostCtx);
  expect(res.ok).toBe(false);
  if (res.ok) {
    throw new Error("unreachable");
  }
  expect(res.error.code).toBe(code);
  return res;
}

describe("panel-bridge-allowlist: method table", () => {
  it("maps every method to the expected tRPC path", () => {
    const paths = Object.fromEntries(
      Object.entries(PANEL_BRIDGE_METHODS).map(([name, def]) => [
        name,
        def.trpcPath,
      ]),
    );
    expect(paths).toEqual({
      getRuns: "runs.latest",
      getMetricNames: "runs.distinctMetricNames",
      getFileLogNames: "runs.distinctFileLogNames",
      getMetrics: "runs.data.graphMultiMetricBatchBucketed",
      getMetricSummaries: "runs.metricSummaries",
      getMetricValues: "runs.data.metricValues",
      getLogs: "runs.data.logs",
      getFileUrl: "runs.data.fileUrl",
    });
  });

  it("rejects unknown methods with FORBIDDEN_METHOD", () => {
    expectError("deleteRuns", {}, "FORBIDDEN_METHOD");
    expectError("runs.latest", {}, "FORBIDDEN_METHOD");
    expectError("", {}, "FORBIDDEN_METHOD");
    // Object prototype members must not resolve as methods
    expectError("toString", {}, "FORBIDDEN_METHOD");
    expectError("constructor", {}, "FORBIDDEN_METHOD");
    expect(isPanelBridgeMethod("hasOwnProperty")).toBe(false);
    expect(isPanelBridgeMethod("getMetrics")).toBe(true);
  });
});

describe("panel-bridge-allowlist: org/project scoping", () => {
  it("always sets organizationId/projectName from host context", () => {
    for (const [method, params] of Object.entries({
      getRuns: {},
      getMetricNames: {},
      getFileLogNames: {},
      getMetrics: { metrics: ["train/loss"] },
      getMetricSummaries: { metrics: ["train/loss"] },
      getMetricValues: { runId: "run-a" },
      getLogs: { runId: "run-a" },
      getFileUrl: { runId: "run-a", logName: "images", fileName: "a.png" },
    })) {
      const res = expectOk(method, params);
      expect(res.input.organizationId).toBe("org_host");
      expect(res.input.projectName).toBe("host-project");
    }
  });

  it("overwrites injected organizationId/projectName in params", () => {
    for (const [method, params] of Object.entries({
      getRuns: { organizationId: "org_evil", projectName: "stolen" },
      getMetrics: {
        metrics: ["train/loss"],
        organizationId: "org_evil",
        projectName: "stolen",
      },
      getLogs: {
        runId: "run-a",
        organizationId: "org_evil",
        projectName: "stolen",
      },
      getFileUrl: {
        runId: "run-a",
        logName: "images",
        fileName: "a.png",
        organizationId: "org_evil",
        projectName: "stolen",
      },
    })) {
      const res = expectOk(method, params);
      expect(res.input.organizationId).toBe("org_host");
      expect(res.input.projectName).toBe("host-project");
      // And the injected values must not leak in under any other key
      expect(JSON.stringify(res.input)).not.toContain("org_evil");
      expect(JSON.stringify(res.input)).not.toContain("stolen");
    }
  });

  it("strips forbidden passthrough flags (includeLineage/preview) from getMetrics", () => {
    const res = expectOk("getMetrics", {
      metrics: ["train/loss"],
      includeLineage: true,
      preview: true,
    });
    expect(res.input).not.toHaveProperty("includeLineage");
    expect(res.input).not.toHaveProperty("preview");
  });
});

describe("panel-bridge-allowlist: getRuns", () => {
  it("applies a default limit and passes a valid one through", () => {
    expect(expectOk("getRuns", undefined).input.limit).toBe(50);
    expect(expectOk("getRuns", {}).input.limit).toBe(50);
    expect(expectOk("getRuns", { limit: 200 }).input.limit).toBe(200);
  });

  it("rejects out-of-range limits (REJECT, not clamp)", () => {
    expectError("getRuns", { limit: 0 }, "BAD_PARAMS");
    expectError("getRuns", { limit: 201 }, "BAD_PARAMS");
    expectError("getRuns", { limit: 1.5 }, "BAD_PARAMS");
    expectError("getRuns", { limit: "10" }, "BAD_PARAMS");
  });
});

describe("panel-bridge-allowlist: getMetricNames / getFileLogNames", () => {
  it("passes search through and rejects >500 chars", () => {
    const res = expectOk("getMetricNames", { search: "train/" });
    expect(res.input.search).toBe("train/");
    expectError("getMetricNames", { search: "x".repeat(501) }, "BAD_PARAMS");
    expectError("getFileLogNames", { search: "x".repeat(501) }, "BAD_PARAMS");
  });

  it("omits search when not provided", () => {
    expect(expectOk("getFileLogNames", {}).input).not.toHaveProperty("search");
  });
});

describe("panel-bridge-allowlist: getMetrics", () => {
  it("defaults runIds to the host's selected runs", () => {
    const res = expectOk("getMetrics", { metrics: ["train/loss"] });
    expect(res.input.runIds).toEqual(["run-a", "run-b", "run-c"]);
    expect(res.input.logNames).toEqual(["train/loss"]);
  });

  it("uses explicit runIds when provided", () => {
    const res = expectOk("getMetrics", {
      metrics: ["train/loss"],
      runIds: ["run-z"],
    });
    expect(res.input.runIds).toEqual(["run-z"]);
  });

  it("truncates the host-side default (not panel-controlled) to 50 runs", () => {
    const bigCtx: PanelHostContext = {
      ...hostCtx,
      selectedRunIds: Array.from({ length: 60 }, (_, i) => `r${i}`),
    };
    const res = buildPanelBridgeRequest(
      "getMetrics",
      { metrics: ["m"] },
      bigCtx,
    );
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.input.runIds).toHaveLength(50);
    }
  });

  it("rejects >50 explicit runIds and >50 metrics", () => {
    expectError(
      "getMetrics",
      { metrics: ["m"], runIds: Array.from({ length: 51 }, (_, i) => `r${i}`) },
      "BAD_PARAMS",
    );
    expectError(
      "getMetrics",
      { metrics: Array.from({ length: 51 }, (_, i) => `m${i}`) },
      "BAD_PARAMS",
    );
  });

  it("rejects empty metrics and empty runIds", () => {
    expectError("getMetrics", { metrics: [] }, "BAD_PARAMS");
    expectError("getMetrics", { metrics: ["m"], runIds: [] }, "BAD_PARAMS");
    expectError("getMetrics", {}, "BAD_PARAMS");
  });

  it("rejects omitted runIds when the host has no selected runs", () => {
    const emptyCtx: PanelHostContext = { ...hostCtx, selectedRunIds: [] };
    for (const method of ["getMetrics", "getMetricSummaries"] as const) {
      const res = buildPanelBridgeRequest(
        method,
        { metrics: ["train/loss"] },
        emptyCtx,
      );
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error.code).toBe("BAD_PARAMS");
        expect(res.error.message).toContain("no runs are selected");
      }
      // Explicit runIds still work with an empty selection.
      const explicit = buildPanelBridgeRequest(
        method,
        { metrics: ["train/loss"], runIds: ["run-z"] },
        emptyCtx,
      );
      expect(explicit.ok).toBe(true);
    }
  });

  it("accepts buckets within 10–2000 and rejects outside", () => {
    expect(
      expectOk("getMetrics", { metrics: ["m"], buckets: 10 }).input.buckets,
    ).toBe(10);
    expect(
      expectOk("getMetrics", { metrics: ["m"], buckets: 2000 }).input.buckets,
    ).toBe(2000);
    expectError("getMetrics", { metrics: ["m"], buckets: 9 }, "BAD_PARAMS");
    expectError("getMetrics", { metrics: ["m"], buckets: 2001 }, "BAD_PARAMS");
    expectError("getMetrics", { metrics: ["m"], buckets: 100.5 }, "BAD_PARAMS");
  });
});

describe("panel-bridge-allowlist: getMetricSummaries", () => {
  it("expands metrics × aggregation into the proc's input shape", () => {
    const res = expectOk("getMetricSummaries", {
      metrics: ["train/loss", "val/loss"],
      aggregation: "MAX",
    });
    expect(res.input.runIds).toEqual(["run-a", "run-b", "run-c"]);
    expect(res.input.metrics).toEqual([
      { logName: "train/loss", aggregation: "MAX" },
      { logName: "val/loss", aggregation: "MAX" },
    ]);
  });

  it("defaults aggregation to LAST", () => {
    const res = expectOk("getMetricSummaries", { metrics: ["m"] });
    expect(res.input.metrics).toEqual([{ logName: "m", aggregation: "LAST" }]);
  });

  it("rejects unknown aggregations and >200 runIds", () => {
    expectError(
      "getMetricSummaries",
      { metrics: ["m"], aggregation: "MEDIAN" },
      "BAD_PARAMS",
    );
    expectError(
      "getMetricSummaries",
      { metrics: ["m"], runIds: Array.from({ length: 201 }, (_, i) => `r${i}`) },
      "BAD_PARAMS",
    );
  });
});

describe("panel-bridge-allowlist: single-run methods", () => {
  it("getMetricValues requires a non-empty runId", () => {
    const res = expectOk("getMetricValues", { runId: "run-a" });
    expect(res.input).toEqual({
      organizationId: "org_host",
      projectName: "host-project",
      runId: "run-a",
    });
    expectError("getMetricValues", {}, "BAD_PARAMS");
    expectError("getMetricValues", { runId: "" }, "BAD_PARAMS");
    expectError("getMetricValues", { runId: 5 }, "BAD_PARAMS");
  });

  it("getLogs passes optional logType and rejects >100 chars", () => {
    const res = expectOk("getLogs", { runId: "run-a", logType: "stderr" });
    expect(res.input.logType).toBe("stderr");
    expect(expectOk("getLogs", { runId: "run-a" }).input).not.toHaveProperty(
      "logType",
    );
    expectError(
      "getLogs",
      { runId: "run-a", logType: "x".repeat(101) },
      "BAD_PARAMS",
    );
  });

  it("getFileUrl requires runId, logName, and fileName", () => {
    const res = expectOk("getFileUrl", {
      runId: "run-a",
      logName: "images",
      fileName: "step_1.png",
    });
    expect(res.input).toEqual({
      organizationId: "org_host",
      projectName: "host-project",
      runId: "run-a",
      logName: "images",
      fileName: "step_1.png",
    });
    expectError("getFileUrl", { runId: "run-a" }, "BAD_PARAMS");
    expectError(
      "getFileUrl",
      { runId: "run-a", logName: "images", fileName: "" },
      "BAD_PARAMS",
    );
  });
});
