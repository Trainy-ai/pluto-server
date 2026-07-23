import { describe, it, expect } from "vitest";
import {
  applyChartsLayout,
  orderGroupMetrics,
  type ChartsLayoutConfig,
} from "./charts-layout";
import { moveRelative, reorder } from "@/lib/array";

// Minimal stand-in for the grouped-metrics payload.
function groups(...keys: string[]): Array<[string, { groupName: string }]> {
  return keys.map((k) => [k, { groupName: k }]);
}
function metrics(...names: string[]): Array<{ name: string }> {
  return names.map((name) => ({ name }));
}
function keysOf<T>(laid: Array<{ key: string } & T>): string[] {
  return laid.map((g) => g.key);
}

describe("applyChartsLayout", () => {
  it("returns groups in default order when no layout is saved", () => {
    const result = applyChartsLayout(groups("loss", "metrics", "system"), null);
    expect(keysOf(result)).toEqual(["loss", "metrics", "system"]);
    expect(result.every((g) => !g.hidden)).toBe(true);
  });

  it("reorders groups listed in layout.order first, in saved order", () => {
    const layout: ChartsLayoutConfig = {
      version: 1,
      order: ["system", "loss"],
      hidden: [],
      metricOrder: {},
    };
    const result = applyChartsLayout(groups("loss", "metrics", "system"), layout);
    // Ordered keys come first; unordered ("metrics") keeps default position after.
    expect(keysOf(result)).toEqual(["system", "loss", "metrics"]);
  });

  it("appends newly-seen groups (not in order) after ordered ones, preserving default order", () => {
    const layout: ChartsLayoutConfig = {
      version: 1,
      order: ["metrics"],
      hidden: [],
      metricOrder: {},
    };
    // "loss" and "newgroup" are not in order — keep their incoming relative order.
    const result = applyChartsLayout(
      groups("loss", "metrics", "newgroup"),
      layout,
    );
    expect(keysOf(result)).toEqual(["metrics", "loss", "newgroup"]);
  });

  it("ignores unknown keys in order (removed groups) without breaking", () => {
    const layout: ChartsLayoutConfig = {
      version: 1,
      order: ["ghost", "metrics", "loss"],
      hidden: [],
      metricOrder: {},
    };
    const result = applyChartsLayout(groups("loss", "metrics"), layout);
    expect(keysOf(result)).toEqual(["metrics", "loss"]);
  });

  it("flags hidden groups but still returns them", () => {
    const layout: ChartsLayoutConfig = {
      version: 1,
      order: [],
      hidden: ["debug"],
      metricOrder: {},
    };
    const result = applyChartsLayout(
      groups("loss", "system", "debug"),
      layout,
    );
    const byKey = Object.fromEntries(result.map((g) => [g.key, g]));
    expect(byKey.debug.hidden).toBe(true);
    expect(byKey.system.hidden).toBe(false);
    expect(byKey.loss.hidden).toBe(false);
    expect(result).toHaveLength(3);
  });
});

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
