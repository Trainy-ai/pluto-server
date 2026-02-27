import { describe, it, expect } from "vitest";
import { searchUtils } from "../search-utils";
import type { GroupedMetrics } from "@/lib/grouping/types";

const MOCK_GROUPED: GroupedMetrics = {
  train: {
    groupName: "train",
    metrics: [
      {
        name: "train/loss",
        type: "METRIC",
        data: [{ runId: "1", runName: "run-1", color: "#f00", status: "COMPLETED" }],
      },
      {
        name: "train/accuracy",
        type: "METRIC",
        data: [{ runId: "1", runName: "run-1", color: "#f00", status: "COMPLETED" }],
      },
    ],
  },
  val: {
    groupName: "val",
    metrics: [
      {
        name: "val/loss",
        type: "METRIC",
        data: [{ runId: "1", runName: "run-1", color: "#f00", status: "COMPLETED" }],
      },
    ],
  },
};

describe("searchUtils.filterMetrics with fuzzy search", () => {
  const searchIndex = searchUtils.createSearchIndex(MOCK_GROUPED);

  it("returns all metrics when query is empty", () => {
    const state = searchUtils.createSearchState("", false);
    const result = searchUtils.filterMetrics("train", MOCK_GROUPED["train"].metrics, searchIndex, state);
    expect(result).toHaveLength(2);
  });

  it("fuzzy matches — 'lloss' finds loss metric", () => {
    const state = searchUtils.createSearchState("lloss", false);
    const result = searchUtils.filterMetrics("train", MOCK_GROUPED["train"].metrics, searchIndex, state);
    expect(result.some((m) => m.name.includes("loss"))).toBe(true);
  });

  it("regex mode still works unchanged", () => {
    const state = searchUtils.createSearchState("train.*loss", true);
    const result = searchUtils.filterMetrics("train", MOCK_GROUPED["train"].metrics, searchIndex, state);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("train/loss");
  });
});

describe("searchUtils.doesGroupMatch with fuzzy search", () => {
  const searchIndex = searchUtils.createSearchIndex(MOCK_GROUPED);

  it("fuzzy matches — 'trian' matches group 'train'", () => {
    const state = searchUtils.createSearchState("trian", false);
    const result = searchUtils.doesGroupMatch("train", searchIndex, state);
    expect(result).toBe(true);
  });

  it("returns false for unrelated query", () => {
    const state = searchUtils.createSearchState("zzzzzzzzz", false);
    const result = searchUtils.doesGroupMatch("train", searchIndex, state);
    expect(result).toBe(false);
  });

  it("regex mode still works", () => {
    const state = searchUtils.createSearchState("^val", true);
    const result = searchUtils.doesGroupMatch("val", searchIndex, state);
    expect(result).toBe(true);
  });
});
