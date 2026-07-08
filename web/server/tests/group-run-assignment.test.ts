import { describe, it, expect } from "vitest";
import {
  computeRunGroupKey,
  buildRunGroupKeyMap,
  fieldValueKeysNeeded,
  type RunForGrouping,
} from "../lib/group-run-assignment";

const RUN_A: RunForGrouping = {
  id: 1n,
  name: "alpha-1",
  status: "COMPLETED",
  tags: ["gpt2", "group:ca", "steps-10k"],
  creatorName: "Ryan",
  creatorEmail: "ryan@example.com",
};

const RUN_B: RunForGrouping = {
  id: 2n,
  name: "alpha-2",
  status: "FAILED",
  tags: ["bert", "group:dog"],
  creatorName: null,
  creatorEmail: "anon@example.com",
};

const RUN_C: RunForGrouping = {
  id: 3n,
  name: "no-tags",
  status: "RUNNING",
  tags: ["one-off"],
  creatorName: null,
  creatorEmail: null,
};

describe("computeRunGroupKey", () => {
  it("derives tag-prefix values from a run's tags", () => {
    expect(computeRunGroupKey(RUN_A, ["tag-prefix:group"], undefined)).toBe(
      JSON.stringify([{ field: "tag-prefix:group", value: "ca" }]),
    );
  });

  it("returns null for runs with no matching tag-prefix", () => {
    expect(computeRunGroupKey(RUN_C, ["tag-prefix:group"], undefined)).toBe(
      JSON.stringify([{ field: "tag-prefix:group", value: null }]),
    );
  });

  it("reads system fields directly off the run", () => {
    expect(computeRunGroupKey(RUN_A, ["system:status"], undefined)).toBe(
      JSON.stringify([{ field: "system:status", value: "COMPLETED" }]),
    );
  });

  it("falls back to creator email when name is missing", () => {
    expect(computeRunGroupKey(RUN_B, ["system:creator.name"], undefined)).toBe(
      JSON.stringify([{ field: "system:creator.name", value: "anon@example.com" }]),
    );
  });

  it("returns null for system:creator.name when neither name nor email exists", () => {
    expect(computeRunGroupKey(RUN_C, ["system:creator.name"], undefined)).toBe(
      JSON.stringify([{ field: "system:creator.name", value: null }]),
    );
  });

  it("reads config values from the supplied field-values map", () => {
    const fv = new Map<string, string | null>([["config:lr", "0.001"]]);
    expect(computeRunGroupKey(RUN_A, ["config:lr"], fv)).toBe(
      JSON.stringify([{ field: "config:lr", value: "0.001" }]),
    );
  });

  it("returns null for config keys that are unset", () => {
    expect(computeRunGroupKey(RUN_A, ["config:missing"], new Map())).toBe(
      JSON.stringify([{ field: "config:missing", value: null }]),
    );
  });

  it("composes nested groupBy chains in order", () => {
    const key = computeRunGroupKey(
      RUN_A,
      ["tag-prefix:group", "system:status"],
      undefined,
    );
    expect(key).toBe(
      JSON.stringify([
        { field: "tag-prefix:group", value: "ca" },
        { field: "system:status", value: "COMPLETED" },
      ]),
    );
  });

  it("skips unparseable fields by emitting value=null", () => {
    expect(computeRunGroupKey(RUN_A, ["bogus:xyz"], undefined)).toBe(
      JSON.stringify([{ field: "bogus:xyz", value: null }]),
    );
  });
});

describe("buildRunGroupKeyMap", () => {
  it("emits one entry per run keyed by numeric ID", () => {
    const m = buildRunGroupKeyMap([RUN_A, RUN_B, RUN_C], ["tag-prefix:group"], new Map());
    expect(m.size).toBe(3);
    expect(m.get(1)).toContain('"value":"ca"');
    expect(m.get(2)).toContain('"value":"dog"');
    expect(m.get(3)).toContain('"value":null');
  });

  it("looks up per-run field values from the field-values map", () => {
    const fv = new Map([[1n, new Map([["config:lr", "0.001"]])]]);
    const m = buildRunGroupKeyMap([RUN_A], ["config:lr"], fv);
    expect(m.get(1)).toContain('"value":"0.001"');
  });
});

describe("fieldValueKeysNeeded", () => {
  it("returns config + sysmeta keys (skips system + tag-prefix)", () => {
    const keys = fieldValueKeysNeeded([
      "tag-prefix:group",
      "system:status",
      "config:lr",
      "systemMetadata:framework",
    ]);
    expect(keys).toEqual([
      { source: "config", key: "lr" },
      { source: "systemMetadata", key: "framework" },
    ]);
  });

  it("returns an empty list when no config/sysmeta fields are referenced", () => {
    expect(fieldValueKeysNeeded(["tag-prefix:group", "system:status"])).toEqual([]);
  });
});
