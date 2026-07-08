import { describe, it, expect } from "vitest";
import { computeRunGroupTrail } from "../compute-run-group-key";

// Minimal Run shape the helpers accept. Extra fields on a real Run are
// irrelevant — the util only reads name/status/tags/creator/_flatConfig/
// _flatSystemMetadata.
type MinRun = Parameters<typeof computeRunGroupTrail>[0];

const run = (overrides: Partial<MinRun> = {}): MinRun => ({
  name: "run-1",
  status: "COMPLETED",
  tags: [],
  ...overrides,
});

describe("computeRunGroupTrail", () => {
  it("returns empty trail for empty groupBy", () => {
    expect(computeRunGroupTrail(run(), [])).toEqual([]);
  });

  describe("kind = system", () => {
    it("resolves system:name to run.name", () => {
      expect(computeRunGroupTrail(run({ name: "training-v2" }), ["system:name"])).toEqual([
        { field: "system:name", value: "training-v2" },
      ]);
    });

    it("resolves system:status to run.status", () => {
      expect(computeRunGroupTrail(run({ status: "FAILED" }), ["system:status"])).toEqual([
        { field: "system:status", value: "FAILED" },
      ]);
    });

    it("resolves system:creator.name to run.creator.name (preferred)", () => {
      const r = run({ creator: { name: "Alice", email: "alice@example.com" } });
      expect(computeRunGroupTrail(r, ["system:creator.name"])).toEqual([
        { field: "system:creator.name", value: "Alice" },
      ]);
    });

    it("falls back to run.creator.email when creator.name is null (COALESCE parity)", () => {
      const r = run({ creator: { name: null, email: "bob@example.com" } });
      expect(computeRunGroupTrail(r, ["system:creator.name"])).toEqual([
        { field: "system:creator.name", value: "bob@example.com" },
      ]);
    });

    it("falls back to run.creator.email when creator.name is undefined", () => {
      const r = run({ creator: { email: "carol@example.com" } });
      expect(computeRunGroupTrail(r, ["system:creator.name"])).toEqual([
        { field: "system:creator.name", value: "carol@example.com" },
      ]);
    });

    it("returns null for system:creator.name when creator is missing entirely", () => {
      // Regression: before c82a82800 this branch returned null for every
      // run — so buckets under "Owner" never matched their selected leaf
      // runs. Even without a creator record, the fallback should be null
      // (not e.g. run.name), matching how server displays "(unset)".
      expect(computeRunGroupTrail(run({ creator: null }), ["system:creator.name"])).toEqual([
        { field: "system:creator.name", value: null },
      ]);
      expect(computeRunGroupTrail(run({}), ["system:creator.name"])).toEqual([
        { field: "system:creator.name", value: null },
      ]);
    });

    it("returns null for other system keys (not name/status/creator.name)", () => {
      expect(computeRunGroupTrail(run(), ["system:createdAt"])).toEqual([
        { field: "system:createdAt", value: null },
      ]);
    });
  });

  describe("kind = config", () => {
    it("resolves config keys against _flatConfig and coerces to string", () => {
      const r = run({ _flatConfig: { batch_size: 512, lr: 0.001, name: "resnet" } });
      expect(computeRunGroupTrail(r, ["config:batch_size", "config:lr", "config:name"])).toEqual([
        { field: "config:batch_size", value: "512" },
        { field: "config:lr", value: "0.001" },
        { field: "config:name", value: "resnet" },
      ]);
    });

    it("returns null when a config key is absent", () => {
      const r = run({ _flatConfig: { lr: 0.001 } });
      expect(computeRunGroupTrail(r, ["config:batch_size"])).toEqual([
        { field: "config:batch_size", value: null },
      ]);
    });

    it("treats an explicit null config value the same as absent (null bucket)", () => {
      const r = run({ _flatConfig: { batch_size: null } });
      expect(computeRunGroupTrail(r, ["config:batch_size"])).toEqual([
        { field: "config:batch_size", value: null },
      ]);
    });

    it("returns null when _flatConfig is missing", () => {
      expect(computeRunGroupTrail(run(), ["config:batch_size"])).toEqual([
        { field: "config:batch_size", value: null },
      ]);
    });
  });

  describe("kind = systemMetadata", () => {
    it("resolves systemMetadata keys against _flatSystemMetadata", () => {
      const r = run({ _flatSystemMetadata: { gpu_count: 8, host: "vm-a" } });
      expect(computeRunGroupTrail(r, ["systemMetadata:gpu_count", "systemMetadata:host"])).toEqual([
        { field: "systemMetadata:gpu_count", value: "8" },
        { field: "systemMetadata:host", value: "vm-a" },
      ]);
    });

    it("returns null when _flatSystemMetadata is missing", () => {
      expect(computeRunGroupTrail(run(), ["systemMetadata:gpu_count"])).toEqual([
        { field: "systemMetadata:gpu_count", value: null },
      ]);
    });
  });

  describe("kind = tag-prefix", () => {
    it("returns the substring after the first matching prefixed tag", () => {
      const r = run({ tags: ["experiment-1", "group:alpha", "other"] });
      expect(computeRunGroupTrail(r, ["tag-prefix:group"])).toEqual([
        { field: "tag-prefix:group", value: "alpha" },
      ]);
    });

    it("returns null when no tag carries the prefix", () => {
      const r = run({ tags: ["experiment-1", "group2:beta"] });
      expect(computeRunGroupTrail(r, ["tag-prefix:group"])).toEqual([
        { field: "tag-prefix:group", value: null },
      ]);
    });

    it("returns null for a bare-prefix tag with no value (`group:`)", () => {
      const r = run({ tags: ["group:"] });
      expect(computeRunGroupTrail(r, ["tag-prefix:group"])).toEqual([
        { field: "tag-prefix:group", value: null },
      ]);
    });

    it("returns the first match wins when multiple tags carry the same prefix", () => {
      const r = run({ tags: ["group:alpha", "group:beta"] });
      expect(computeRunGroupTrail(r, ["tag-prefix:group"])).toEqual([
        { field: "tag-prefix:group", value: "alpha" },
      ]);
    });
  });

  describe("parseField edge cases", () => {
    it("returns null value for fields with unknown kind", () => {
      expect(computeRunGroupTrail(run(), ["bogus:x"])).toEqual([
        { field: "bogus:x", value: null },
      ]);
    });

    it("returns null value for fields with empty key", () => {
      expect(computeRunGroupTrail(run(), ["config:"])).toEqual([
        { field: "config:", value: null },
      ]);
    });

    it("returns null value for fields with no colon", () => {
      expect(computeRunGroupTrail(run(), ["config"])).toEqual([
        { field: "config", value: null },
      ]);
    });
  });

  describe("multi-level trails", () => {
    it("preserves groupBy order and produces one entry per field", () => {
      const r = run({
        name: "run-A",
        tags: ["group:alpha"],
        _flatConfig: { batch_size: 32 },
        creator: { name: "Dev" },
      });
      const trail = computeRunGroupTrail(r, [
        "tag-prefix:group",
        "config:batch_size",
        "system:creator.name",
      ]);
      expect(trail).toEqual([
        { field: "tag-prefix:group", value: "alpha" },
        { field: "config:batch_size", value: "32" },
        { field: "system:creator.name", value: "Dev" },
      ]);
    });
  });
});
