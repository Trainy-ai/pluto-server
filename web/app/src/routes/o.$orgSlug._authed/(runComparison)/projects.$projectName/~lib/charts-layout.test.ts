import { describe, it, expect } from "vitest";
import {
  orderGroupMetrics,
  applyChartsSections,
  type ChartsLayoutConfig,
} from "./charts-layout";
import { moveRelative, reorder } from "@/lib/array";

function metrics(...names: string[]): Array<{ name: string }> {
  return names.map((name) => ({ name }));
}
function layout(partial: Partial<ChartsLayoutConfig>): ChartsLayoutConfig {
  return {
    version: 2,
    order: [],
    hidden: [],
    metricOrder: {},
    customSections: [],
    membership: {},
    ...partial,
  };
}

describe("orderGroupMetrics", () => {
  it("returns the same array reference when no order is saved", () => {
    const list = metrics("a", "b");
    expect(orderGroupMetrics(list, undefined)).toBe(list);
    expect(orderGroupMetrics(list, [])).toBe(list);
  });

  it("returns the same reference when the saved order matches the default", () => {
    const list = metrics("a", "b");
    expect(orderGroupMetrics(list, ["a", "b"])).toBe(list);
  });

  it("puts saved names first, in saved order", () => {
    const list = metrics("a", "b", "c");
    expect(orderGroupMetrics(list, ["c", "a"]).map((m) => m.name)).toEqual([
      "c",
      "a",
      "b",
    ]);
  });

  it("appends unlisted (new) metrics after ordered ones, preserving default order", () => {
    const list = metrics("a", "b", "c", "d");
    expect(orderGroupMetrics(list, ["b"]).map((m) => m.name)).toEqual([
      "b",
      "a",
      "c",
      "d",
    ]);
  });

  it("ignores unknown names in the saved order (removed metrics)", () => {
    const list = metrics("a", "b");
    expect(orderGroupMetrics(list, ["ghost", "b", "a"]).map((m) => m.name)).toEqual(
      ["b", "a"],
    );
  });
});

describe("moveRelative", () => {
  it("moves a key before another", () => {
    expect(moveRelative(["a", "b", "c"], "c", "a", "before")).toEqual([
      "c",
      "a",
      "b",
    ]);
  });
  it("moves a key after another", () => {
    expect(moveRelative(["a", "b", "c"], "a", "c", "after")).toEqual([
      "b",
      "c",
      "a",
    ]);
  });
  it("accounts for removal shift when moving forward", () => {
    expect(moveRelative(["a", "b", "c", "d"], "a", "c", "before")).toEqual([
      "b",
      "a",
      "c",
      "d",
    ]);
  });
  it("is a no-op (same reference) for self-drops, unknown keys, and in-place moves", () => {
    const list = ["a", "b", "c"];
    expect(moveRelative(list, "a", "a", "before")).toBe(list);
    expect(moveRelative(list, "ghost", "a", "before")).toBe(list);
    expect(moveRelative(list, "a", "ghost", "after")).toBe(list);
    expect(moveRelative(list, "a", "b", "before")).toBe(list);
    expect(moveRelative(list, "b", "a", "after")).toBe(list);
  });
});

describe("reorder", () => {
  it("moves an item forward", () => {
    expect(reorder(["a", "b", "c", "d"], 0, 2)).toEqual(["b", "c", "a", "d"]);
  });
  it("moves an item backward", () => {
    expect(reorder(["a", "b", "c", "d"], 3, 1)).toEqual(["a", "d", "b", "c"]);
  });
  it("is a no-op for equal or out-of-range indices", () => {
    const list = ["a", "b"];
    expect(reorder(list, 1, 1)).toBe(list);
    expect(reorder(list, -1, 0)).toBe(list);
    expect(reorder(list, 0, 5)).toBe(list);
  });
});

describe("applyChartsSections", () => {
  function sources(spec: Record<string, string[]>) {
    return Object.entries(spec).map(([key, names]) => ({
      key,
      groupName: key,
      items: names.map((name) => ({ name })),
    }));
  }
  const nameOf = (m: { name: string }) => m.name;
  function namesBySection(result: Array<{ key: string; items: Array<{ name: string }> }>) {
    return Object.fromEntries(result.map((s) => [s.key, s.items.map(nameOf)]));
  }

  it("is a pass-through with no layout", () => {
    const src = sources({ loss: ["a", "b"], system: ["gpu"] });
    const result = applyChartsSections(src, nameOf, null);
    expect(result.map((s) => s.key)).toEqual(["loss", "system"]);
    expect(result.every((s) => !s.hidden && !s.isCustom)).toBe(true);
    // Reference-stable: untouched sections reuse the source items array.
    expect(result[0].items).toBe(src[0].items);
  });

  it("re-homes a metric to another derived section per membership", () => {
    const src = sources({ loss: ["a", "b"], system: ["gpu"] });
    const result = applyChartsSections(src, nameOf, layout({ membership: { a: "system" } }));
    expect(namesBySection(result)).toEqual({ loss: ["b"], system: ["gpu", "a"] });
  });

  it("materializes a custom section holding its members, named from customSections", () => {
    const result = applyChartsSections(
      sources({ loss: ["a", "b"] }),
      nameOf,
      layout({
        customSections: [{ key: "custom:x", name: "Mine" }],
        membership: { b: "custom:x" },
      }),
    );
    expect(namesBySection(result)).toEqual({ loss: ["a"], "custom:x": ["b"] });
    const custom = result.find((s) => s.key === "custom:x")!;
    expect(custom.groupName).toBe("Mine");
    expect(custom.isCustom).toBe(true);
  });

  it("ignores membership pointing at a deleted/unknown section (fallback to derived home)", () => {
    const src = sources({ loss: ["a", "b"] });
    const result = applyChartsSections(src, nameOf, layout({ membership: { a: "custom:gone" } }));
    expect(namesBySection(result)).toEqual({ loss: ["a", "b"] });
    // Full fallback keeps the source array reference.
    expect(result[0].items).toBe(src[0].items);
  });

  it("drops empty sections by default, keeps them with keepEmpty (edit mode)", () => {
    const cfg = layout({
      customSections: [{ key: "custom:empty", name: "Empty" }],
      membership: { a: "system" },
    });
    const src = sources({ loss: ["a"], system: ["gpu"] });
    const normal = applyChartsSections(src, nameOf, cfg);
    expect(normal.map((s) => s.key)).toEqual(["system"]); // loss emptied, custom empty
    const editing = applyChartsSections(src, nameOf, cfg, { keepEmpty: true });
    expect(editing.map((s) => s.key)).toEqual(["loss", "system", "custom:empty"]);
  });

  it("applies saved order and hidden flags across derived + custom sections", () => {
    const result = applyChartsSections(
      sources({ loss: ["a"], system: ["gpu"] }),
      nameOf,
      layout({
        customSections: [{ key: "custom:x", name: "Mine" }],
        membership: { a: "custom:x" },
        order: ["custom:x", "system"],
        hidden: ["system"],
      }),
    );
    expect(result.map((s) => s.key)).toEqual(["custom:x", "system"]);
    expect(result.find((s) => s.key === "system")!.hidden).toBe(true);
  });

  it("appends re-homed items at end even when target section comes before source in sources array", () => {
    const src = sources({ system: ["gpu"], loss: ["a"] });
    const result = applyChartsSections(src, nameOf, layout({ membership: { a: "system" } }));
    // "system" is first in sources, "loss" is second. But "a" from loss is re-homed to system.
    // It should still append after "gpu" (original items first). Loss becomes empty so filtered out.
    expect(namesBySection(result)).toEqual({ system: ["gpu", "a"] });
  });

  it("preserves order when multiple items from different sources move into the same custom section", () => {
    const src = sources({ loss: ["a", "b"], system: ["c"] });
    const result = applyChartsSections(
      src,
      nameOf,
      layout({
        customSections: [{ key: "custom:mixed", name: "Mixed" }],
        membership: { b: "custom:mixed", c: "custom:mixed" },
      }),
    );
    // Items go to custom:mixed in source-array order: first "b" (from loss),
    // then "c" (from system), preserving their relative order. System becomes empty so filtered out.
    expect(namesBySection(result)).toEqual({
      loss: ["a"],
      "custom:mixed": ["b", "c"],
    });
  });

  it("ignores custom sections with keys colliding with derived sections, degrades gracefully", () => {
    const src = sources({ loss: ["a"] });
    // Collision: custom section with key "loss" which is already a derived source.
    const result = applyChartsSections(
      src,
      nameOf,
      layout({
        customSections: [
          { key: "loss", name: "Colliding" },
          { key: "custom:valid", name: "Valid" },
        ],
        membership: { a: "loss" }, // membership targets the colliding key
      }),
    );
    // The colliding custom section is filtered out; result has exactly one "loss" (derived).
    // Membership entry targeting "loss" resolves to the derived section key (graceful degradation).
    // custom:valid is empty so also filtered out by default.
    const laidOut = result.map((s) => s.key);
    expect(laidOut).toEqual(["loss"]);
    // Exactly one section with key "loss" (the derived one), not two.
    const lossSections = result.filter((s) => s.key === "loss");
    expect(lossSections).toHaveLength(1);
    expect(lossSections[0].isCustom).toBe(false);
    expect(lossSections[0].items.map(nameOf)).toEqual(["a"]);
  });
});
