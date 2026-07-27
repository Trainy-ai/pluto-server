import { describe, it, expect } from "vitest";
import {
  reconcileDraftGroups,
  buildDraftConfig,
  type DraftGroup,
} from "./use-charts-layout-draft";

function group(partial: Partial<DraftGroup> & { key: string }): DraftGroup {
  return {
    name: partial.key,
    isCustom: false,
    hidden: false,
    metricNames: [],
    defaultMetricNames: [],
    ...partial,
  };
}

describe("buildDraftConfig", () => {
  const homes = new Map([
    ["a", "loss"],
    ["b", "loss"],
    ["gpu", "system"],
  ]);

  it("emits membership only for metrics living outside their derived home", () => {
    const cfg = buildDraftConfig(
      [
        group({ key: "loss", metricNames: ["b"], defaultMetricNames: ["a", "b"] }),
        group({ key: "system", metricNames: ["gpu", "a"], defaultMetricNames: ["gpu"] }),
      ],
      homes,
    );
    expect(cfg.version).toBe(2);
    expect(cfg.membership).toEqual({ a: "system" });
  });

  it("emits customSections for custom draft groups and prunes nothing else", () => {
    const cfg = buildDraftConfig(
      [
        group({ key: "loss", metricNames: ["a"], defaultMetricNames: ["a", "b"] }),
        group({
          key: "custom:x",
          name: "Mine",
          isCustom: true,
          metricNames: ["b"],
          defaultMetricNames: [],
        }),
      ],
      homes,
    );
    expect(cfg.customSections).toEqual([{ key: "custom:x", name: "Mine" }]);
    expect(cfg.membership).toEqual({ b: "custom:x" });
    expect(cfg.order).toEqual(["loss", "custom:x"]);
    // custom section's chart order persists (its default baseline is empty)
    expect(cfg.metricOrder["custom:x"]).toEqual(["b"]);
  });

  it("persists metricOrder only for sections that differ from their baseline", () => {
    const cfg = buildDraftConfig(
      [
        group({ key: "loss", metricNames: ["b", "a"], defaultMetricNames: ["a", "b"] }),
        group({ key: "system", metricNames: ["gpu"], defaultMetricNames: ["gpu"] }),
      ],
      homes,
    );
    expect(cfg.metricOrder).toEqual({ loss: ["b", "a"] });
  });
});

describe("reconcileDraftGroups", () => {
  it("preserves an unsaved cross-section move when the base refreshes", () => {
    // Draft moved "a" from loss into system; incoming (saved layout) still has it in loss.
    const prev = [
      group({ key: "loss", metricNames: ["b"], defaultMetricNames: ["a", "b"] }),
      group({ key: "system", metricNames: ["gpu", "a"], defaultMetricNames: ["gpu"] }),
    ];
    const incoming = [
      group({ key: "loss", metricNames: ["a", "b"], defaultMetricNames: ["a", "b"] }),
      group({ key: "system", metricNames: ["gpu"], defaultMetricNames: ["gpu"] }),
    ];
    const next = reconcileDraftGroups(prev, incoming);
    expect(next.find((g) => g.key === "system")!.metricNames).toEqual(["gpu", "a"]);
    expect(next.find((g) => g.key === "loss")!.metricNames).toEqual(["b"]);
  });

  it("appends genuinely new metrics to the section the incoming arrangement places them in", () => {
    const prev = [group({ key: "loss", metricNames: ["a"], defaultMetricNames: ["a"] })];
    const incoming = [
      group({ key: "loss", metricNames: ["a", "new"], defaultMetricNames: ["a", "new"] }),
    ];
    const next = reconcileDraftGroups(prev, incoming);
    expect(next[0].metricNames).toEqual(["a", "new"]);
    expect(next[0].defaultMetricNames).toEqual(["a", "new"]);
  });

  it("drops metrics that no longer exist anywhere", () => {
    const prev = [group({ key: "loss", metricNames: ["a", "gone"], defaultMetricNames: ["a"] })];
    const incoming = [group({ key: "loss", metricNames: ["a"], defaultMetricNames: ["a"] })];
    expect(reconcileDraftGroups(prev, incoming)[0].metricNames).toEqual(["a"]);
  });

  it("keeps unsaved custom sections that the incoming base does not know about", () => {
    const prev = [
      group({ key: "loss", metricNames: ["b"], defaultMetricNames: ["a", "b"] }),
      group({
        key: "custom:x",
        name: "Mine",
        isCustom: true,
        metricNames: ["a"],
        defaultMetricNames: [],
      }),
    ];
    const incoming = [
      group({ key: "loss", metricNames: ["a", "b"], defaultMetricNames: ["a", "b"] }),
    ];
    const next = reconcileDraftGroups(prev, incoming);
    expect(next.map((g) => g.key)).toEqual(["loss", "custom:x"]);
    expect(next.find((g) => g.key === "custom:x")!.metricNames).toEqual(["a"]);
  });

  it("drops derived groups that disappeared and appends new incoming groups", () => {
    const prev = [group({ key: "old", metricNames: ["x"], defaultMetricNames: ["x"] })];
    const incoming = [group({ key: "fresh", metricNames: ["y"], defaultMetricNames: ["y"] })];
    expect(reconcileDraftGroups(prev, incoming).map((g) => g.key)).toEqual(["fresh"]);
  });

  it("does not duplicate a metric that reappears in a brand-new incoming group", () => {
    const prev = [
      group({ key: "loss", metricNames: ["a", "b"], defaultMetricNames: ["a", "b"] }),
    ];
    const incoming = [
      group({ key: "loss", metricNames: ["b"], defaultMetricNames: ["b"] }),
      group({ key: "newgroup", metricNames: ["a"], defaultMetricNames: ["a"] }),
    ];
    const next = reconcileDraftGroups(prev, incoming);
    expect(next.find((g) => g.key === "loss")!.metricNames).toEqual(["a", "b"]);
    expect(next.find((g) => g.key === "newgroup")!.metricNames).toEqual([]);
    const allNames = next.flatMap((g) => g.metricNames);
    expect(new Set(allNames).size).toBe(allNames.length);
  });

  it("does not duplicate an unsaved cross-section move when its old home vanishes and it reappears under a new key", () => {
    const prev = [
      group({ key: "loss", metricNames: ["b"], defaultMetricNames: ["a", "b"] }),
      group({ key: "system", metricNames: ["gpu", "a"], defaultMetricNames: ["gpu"] }),
    ];
    const incoming = [
      group({ key: "system", metricNames: ["gpu"], defaultMetricNames: ["gpu"] }),
      group({ key: "loss2", metricNames: ["a"], defaultMetricNames: ["a"] }),
    ];
    const next = reconcileDraftGroups(prev, incoming);
    expect(next.map((g) => g.key)).toEqual(["system", "loss2"]);
    expect(next.find((g) => g.key === "system")!.metricNames).toEqual(["gpu", "a"]);
    expect(next.find((g) => g.key === "loss2")!.metricNames).toEqual([]);
  });
});
