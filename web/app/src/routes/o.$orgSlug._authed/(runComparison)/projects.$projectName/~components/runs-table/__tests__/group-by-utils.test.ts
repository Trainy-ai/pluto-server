import { describe, expect, it } from "vitest";
import {
  computeSelectedAncestorPaths,
  encodePath,
  extractRunGroupValue,
} from "../group-by-utils";

const mkRun = (id: string, fields: Record<string, unknown> = {}) =>
  ({
    id,
    name: undefined,
    status: undefined,
    creator: undefined,
    tags: [],
    _flatConfig: {},
    _flatSystemMetadata: {},
    ...fields,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any;

describe("extractRunGroupValue", () => {
  it("reads system:status", () => {
    expect(extractRunGroupValue(mkRun("a", { status: "Completed" }), "system:status")).toBe("Completed");
  });
  it("reads system:name", () => {
    expect(extractRunGroupValue(mkRun("a", { name: "run-x" }), "system:name")).toBe("run-x");
  });
  it("reads system:creator.name through .creator.name", () => {
    expect(extractRunGroupValue(mkRun("a", { creator: { name: "alice" } }), "system:creator.name")).toBe("alice");
  });
  it("falls back to creator.email when creator.name is null (COALESCE parity)", () => {
    // Mirrors the server's `COALESCE(u.name, u.email)` for the
    // creator.name group field — email-only users must land in the
    // same bucket the server placed them in, not "(unset)".
    expect(extractRunGroupValue(mkRun("a", { creator: { name: null, email: "bob@example.com" } }), "system:creator.name")).toBe("bob@example.com");
    expect(extractRunGroupValue(mkRun("a", { creator: { email: "carol@example.com" } }), "system:creator.name")).toBe("carol@example.com");
  });
  it("returns null when both creator.name and creator.email are absent", () => {
    expect(extractRunGroupValue(mkRun("a", { creator: {} }), "system:creator.name")).toBeNull();
    expect(extractRunGroupValue(mkRun("a"), "system:creator.name")).toBeNull();
  });
  it("returns null when system field is missing", () => {
    expect(extractRunGroupValue(mkRun("a"), "system:status")).toBeNull();
  });
  it("reads config from _flatConfig", () => {
    expect(extractRunGroupValue(mkRun("a", { _flatConfig: { lr: 0.01 } }), "config:lr")).toBe("0.01");
  });
  it("reads systemMetadata from _flatSystemMetadata", () => {
    expect(extractRunGroupValue(mkRun("a", { _flatSystemMetadata: { host: "h1" } }), "systemMetadata:host")).toBe("h1");
  });
  it("returns null when config key is unset", () => {
    expect(extractRunGroupValue(mkRun("a"), "config:lr")).toBeNull();
  });
  it("reads tag-prefix from tags array", () => {
    expect(extractRunGroupValue(mkRun("a", { tags: ["group:alpha", "env:prod"] }), "tag-prefix:group")).toBe("alpha");
  });
  it("returns null when no tag matches the prefix", () => {
    expect(extractRunGroupValue(mkRun("a", { tags: ["env:prod"] }), "tag-prefix:group")).toBeNull();
  });
  it("returns null for malformed field strings", () => {
    expect(extractRunGroupValue(mkRun("a", { name: "x" }), "garbled-no-colon")).toBeNull();
    expect(extractRunGroupValue(mkRun("a"), "")).toBeNull();
  });
});

describe("computeSelectedAncestorPaths", () => {
  it("returns empty array when groupBy is empty", () => {
    expect(computeSelectedAncestorPaths({}, [])).toEqual([]);
  });

  it("returns one map per level", () => {
    const result = computeSelectedAncestorPaths({}, ["system:status"]);
    expect(result).toHaveLength(1);
    expect(result[0].size).toBe(0);
  });

  it("builds 1-level path map from 2 distinct status values, count 1 each", () => {
    const selected = {
      r1: { run: mkRun("r1", { status: "Completed" }), color: "#fff" },
      r2: { run: mkRun("r2", { status: "Failed" }), color: "#000" },
    };
    const result = computeSelectedAncestorPaths(selected, ["system:status"]);
    expect(result[0].size).toBe(2);
    expect(result[0].get(encodePath(["Completed"]))).toBe(1);
    expect(result[0].get(encodePath(["Failed"]))).toBe(1);
  });

  it("counts duplicates when multiple selected runs share a path", () => {
    const selected = {
      r1: { run: mkRun("r1", { status: "Completed" }), color: "#fff" },
      r2: { run: mkRun("r2", { status: "Completed" }), color: "#aaa" },
      r3: { run: mkRun("r3", { status: "Completed" }), color: "#bbb" },
    };
    const result = computeSelectedAncestorPaths(selected, ["system:status"]);
    expect(result[0].size).toBe(1);
    expect(result[0].get(encodePath(["Completed"]))).toBe(3);
  });

  it("builds nested path map across 2 grouping levels", () => {
    const selected = {
      r1: { run: mkRun("r1", { status: "Completed", name: "heavy-a-bs8" }), color: "#fff" },
      r2: { run: mkRun("r2", { status: "Failed", name: "heavy-a-bs8" }), color: "#000" },
    };
    const result = computeSelectedAncestorPaths(selected, ["system:status", "system:name"]);
    expect(result).toHaveLength(2);
    expect(result[0].size).toBe(2);
    expect(result[0].get(encodePath(["Completed"]))).toBe(1);
    expect(result[0].get(encodePath(["Failed"]))).toBe(1);
    expect(result[1].size).toBe(2);
    expect(result[1].get(encodePath(["Completed", "heavy-a-bs8"]))).toBe(1);
    expect(result[1].get(encodePath(["Failed", "heavy-a-bs8"]))).toBe(1);
  });

  it("encodes null group values for runs missing the field (the '(unset)' bucket)", () => {
    const selected = {
      r1: { run: mkRun("r1", { _flatConfig: { lr: 0.01 } }), color: "#fff" },
      r2: { run: mkRun("r2"), color: "#000" },
    };
    const result = computeSelectedAncestorPaths(selected, ["config:lr"]);
    expect(result[0].size).toBe(2);
    expect(result[0].get(encodePath(["0.01"]))).toBe(1);
    expect(result[0].get(encodePath([null]))).toBe(1);
  });
});
