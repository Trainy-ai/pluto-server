import { describe, it, expect } from "vitest";
import { bucketMetricsByPrefix, splitMetricPath } from "../bucket-metrics";

describe("splitMetricPath", () => {
  it("splits on the last `/`", () => {
    expect(splitMetricPath("a/b/c")).toEqual({ prefix: "a/b", suffix: "c" });
  });

  it("returns empty prefix when no `/` is present", () => {
    expect(splitMetricPath("loss")).toEqual({ prefix: "", suffix: "loss" });
  });

  it("handles deep paths", () => {
    expect(splitMetricPath("training/gradient/norms/layer_0/min")).toEqual({
      prefix: "training/gradient/norms/layer_0",
      suffix: "min",
    });
  });

  it("handles trailing slash (empty suffix)", () => {
    expect(splitMetricPath("a/")).toEqual({ prefix: "a", suffix: "" });
  });
});

describe("bucketMetricsByPrefix — literal-allowlist mode", () => {
  const metrics = [
    "a/min",
    "a/max",
    "a/std",
    "b/min",
    "b/std",
    "lone",
  ];

  it("no grouping returns all metrics as passthrough", () => {
    const { groups, passthrough } = bucketMetricsByPrefix(metrics, [], []);
    expect(groups.size).toBe(0);
    expect(passthrough).toEqual(metrics);
  });

  it("suffix-only grouping buckets metrics by prefix and passes through non-matching suffixes", () => {
    const { groups, passthrough } = bucketMetricsByPrefix(metrics, ["min", "max"]);
    expect(groups.size).toBe(1);
    expect(groups.get("a")?.members).toEqual(["a/min", "a/max"]);
    // b/min has no sibling matching the suffix list (b/max isn't there) → singleton fallback
    expect(passthrough.sort()).toEqual(["a/std", "b/min", "b/std", "lone"].sort());
  });

  it("group titles default to the prefix in literal mode", () => {
    const { groups } = bucketMetricsByPrefix(
      ["layer_0/min", "layer_0/max"],
      ["min", "max"],
    );
    expect(groups.get("layer_0")?.title).toBe("layer_0");
    expect(groups.get("layer_0")?.key).toBe("layer_0");
  });

  it("singleton groups (1 member) fall back to passthrough", () => {
    const { groups, passthrough } = bucketMetricsByPrefix(
      ["x/min"],
      ["min", "max", "mean"],
    );
    expect(groups.size).toBe(0);
    expect(passthrough).toEqual(["x/min"]);
  });

  it("prefix allowlist limits which prefixes combine; non-matching prefixes still passthrough", () => {
    const ms = [
      "a/min",
      "a/max",
      "a/std",
      "b/min",
      "b/max",
      "b/std",
    ];
    const { groups, passthrough } = bucketMetricsByPrefix(
      ms,
      ["min", "max"],
      ["a"],
    );
    expect(groups.size).toBe(1);
    expect(groups.get("a")?.members).toEqual(["a/min", "a/max"]);
    expect(passthrough.sort()).toEqual(["a/std", "b/max", "b/min", "b/std"].sort());
  });

  it("metrics with no `/` separator never combine; they always passthrough", () => {
    const { groups, passthrough } = bucketMetricsByPrefix(
      ["loss", "acc", "lr"],
      ["loss", "acc", "lr"],
    );
    expect(groups.size).toBe(0);
    expect(passthrough.sort()).toEqual(["acc", "loss", "lr"]);
  });

  it("prefix allowlist without suffix filter is a no-op (no combining)", () => {
    const { groups, passthrough } = bucketMetricsByPrefix(metrics, [], ["a"]);
    expect(groups.size).toBe(0);
    expect(passthrough).toEqual(metrics);
  });

  it("trims whitespace from suffix and prefix entries", () => {
    const { groups } = bucketMetricsByPrefix(
      ["a/min", "a/max"],
      [" min ", "max"],
      [" a "],
    );
    expect(groups.size).toBe(1);
    expect(groups.get("a")?.members).toEqual(["a/min", "a/max"]);
  });

  it("ignores empty-string entries in the input lists", () => {
    const { groups, passthrough } = bucketMetricsByPrefix(
      ["a/min", "a/max"],
      ["", "min", "max"],
      [""],
    );
    expect(groups.size).toBe(1);
    expect(groups.get("a")?.members).toEqual(["a/min", "a/max"]);
    expect(passthrough).toEqual([]);
  });

  it("empty metrics list returns empty result", () => {
    const { groups, passthrough } = bucketMetricsByPrefix([], ["min"], []);
    expect(groups.size).toBe(0);
    expect(passthrough).toEqual([]);
  });

  it("multiple distinct prefixes each get their own combined widget", () => {
    const ms = [
      "layer_0/min",
      "layer_0/max",
      "layer_0/mean",
      "layer_1/min",
      "layer_1/max",
      "layer_1/mean",
    ];
    const { groups, passthrough } = bucketMetricsByPrefix(ms, ["min", "max", "mean"]);
    expect(groups.size).toBe(2);
    expect(groups.get("layer_0")?.members).toEqual(["layer_0/min", "layer_0/max", "layer_0/mean"]);
    expect(groups.get("layer_1")?.members).toEqual(["layer_1/min", "layer_1/max", "layer_1/mean"]);
    expect(passthrough).toEqual([]);
  });

  it("preserves insertion order within each group", () => {
    const ms = ["a/c", "a/b", "a/a"];
    const { groups } = bucketMetricsByPrefix(ms, ["a", "b", "c"]);
    expect(groups.get("a")?.members).toEqual(["a/c", "a/b", "a/a"]);
  });
});

describe("bucketMetricsByPrefix — regex mode", () => {
  const validationMetrics = [
    "validation/bitbrains_fast_storage/5T/original/CRPS",
    "validation/bitbrains_fast_storage/5T/original/MASE",
    "validation/bitbrains_fast_storage/H/original/CRPS",
    "validation/bitbrains_fast_storage/H/original/MASE",
    "training/loss",
  ];

  it("multi-capture regex buckets metrics by tuple of captures", () => {
    // Capture (bucket, stat) → 4 distinct tuples → all singletons → all fall to passthrough.
    // Add a duplicate to force a group.
    const ms = [
      ...validationMetrics,
      "validation/bitbrains_fast_storage/5T/original/CRPS",
      "validation/bitbrains_fast_storage/5T/original/MASE",
    ];
    const { groups } = bucketMetricsByPrefix(
      ms,
      ["CRPS", "MASE"],
      [],
      "validation/bitbrains_fast_storage/(.*?)/original/(.*?)$",
    );
    // Without dedup: each (bucket, stat) tuple has 2 members because of duplicates above
    // Each tuple {(5T,CRPS), (5T,MASE), (H,CRPS), (H,MASE)} → only 5T tuples have 2 members
    expect(groups.size).toBe(2);
    expect(Array.from(groups.values()).map((g) => g.title).sort()).toEqual(
      ["5T · CRPS", "5T · MASE"],
    );
  });

  it("single capture group buckets by single value", () => {
    const ms = [
      "a/x/min",
      "a/x/max",
      "a/y/min",
      "a/y/max",
    ];
    const { groups } = bucketMetricsByPrefix(
      ms,
      ["min", "max"],
      [],
      "a/(.*?)/", // capture middle segment
    );
    expect(groups.size).toBe(2);
    expect(groups.get("x")?.members).toEqual(["a/x/min", "a/x/max"]);
    expect(groups.get("y")?.members).toEqual(["a/y/min", "a/y/max"]);
    expect(groups.get("x")?.title).toBe("x");
  });

  it("zero capture groups bucket all matching metrics into one widget", () => {
    const ms = [
      "validation/x/min",
      "validation/x/max",
      "validation/y/min",
      "validation/y/max",
      "training/loss",
    ];
    const { groups, passthrough } = bucketMetricsByPrefix(
      ms,
      ["min", "max"],
      [],
      "^validation/", // no captures
    );
    expect(groups.size).toBe(1);
    const only = Array.from(groups.values())[0];
    expect(only.members.sort()).toEqual([
      "validation/x/max",
      "validation/x/min",
      "validation/y/max",
      "validation/y/min",
    ].sort());
    expect(only.title).toBe("matches");
    expect(passthrough).toEqual(["training/loss"]);
  });

  it("invalid regex degrades to literal-allowlist mode", () => {
    const ms = ["a/min", "a/max", "b/min"];
    const { groups, passthrough } = bucketMetricsByPrefix(
      ms,
      ["min", "max"],
      ["a"],
      "(unclosed", // invalid regex
    );
    // Falls back to literal allowlist: only `a` combines
    expect(groups.size).toBe(1);
    expect(groups.get("a")?.members).toEqual(["a/min", "a/max"]);
    expect(passthrough).toEqual(["b/min"]);
  });

  it("regex that doesn't match any metric returns all as passthrough", () => {
    const ms = ["a/min", "a/max", "b/min", "b/max"];
    const { groups, passthrough } = bucketMetricsByPrefix(
      ms,
      ["min", "max"],
      [],
      "^nonexistent/(.+)$",
    );
    expect(groups.size).toBe(0);
    expect(passthrough.sort()).toEqual(ms.sort());
  });

  it("regex mode ignores literal allowlist (regex wins)", () => {
    const ms = ["a/x/min", "a/x/max", "b/x/min", "b/x/max"];
    const { groups } = bucketMetricsByPrefix(
      ms,
      ["min", "max"],
      ["a/x"], // would only allow `a/x` in literal mode
      "(.+)/x", // but regex captures both `a` and `b`
    );
    // Regex mode active → both groups exist
    expect(groups.size).toBe(2);
    expect(groups.get("a")?.members).toEqual(["a/x/min", "a/x/max"]);
    expect(groups.get("b")?.members).toEqual(["b/x/min", "b/x/max"]);
  });

  it("regex-matched singletons fall back to passthrough", () => {
    const ms = [
      "a/x/min",
      "a/x/max",
      "b/y/min", // singleton tuple (b, ...) under suffix `min` only
    ];
    const { groups, passthrough } = bucketMetricsByPrefix(
      ms,
      ["min", "max"],
      [],
      "(.+)/(.+)/",
    );
    // (a, x) has 2 members; (b, y) has 1 → falls to passthrough
    expect(groups.size).toBe(1);
    expect(passthrough).toEqual(["b/y/min"]);
  });

  it("empty regex string is treated as no regex (literal mode active)", () => {
    const ms = ["a/min", "a/max"];
    const { groups } = bucketMetricsByPrefix(ms, ["min", "max"], ["a"], "");
    expect(groups.size).toBe(1);
    expect(groups.get("a")?.members).toEqual(["a/min", "a/max"]);
  });

  it("whitespace-only regex is treated as no regex", () => {
    const ms = ["a/min", "a/max"];
    const { groups } = bucketMetricsByPrefix(ms, ["min", "max"], ["a"], "   ");
    expect(groups.size).toBe(1);
    expect(groups.get("a")?.members).toEqual(["a/min", "a/max"]);
  });

  it("regex requires suffix filter to combine (suffix gates regex mode too)", () => {
    const { groups, passthrough } = bucketMetricsByPrefix(
      ["a/x/min", "a/x/max"],
      [], // no suffix filter
      [],
      "(.+)/x",
    );
    // No suffix filter → no combining at all even if regex set
    expect(groups.size).toBe(0);
    expect(passthrough).toEqual(["a/x/min", "a/x/max"]);
  });
});
