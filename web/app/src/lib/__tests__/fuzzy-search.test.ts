import { describe, it, expect } from "vitest";
import { fuzzyFilter } from "../fuzzy-search";

const SAMPLE_METRICS = [
  "train/loss",
  "train/accuracy",
  "val/loss",
  "val/accuracy",
  "learning_rate",
  "epoch",
  "grad_norm",
];

describe("fuzzyFilter", () => {
  it("returns all items unchanged when query is empty", () => {
    expect(fuzzyFilter(SAMPLE_METRICS, "")).toEqual(SAMPLE_METRICS);
  });

  it("returns all items unchanged when query is whitespace", () => {
    expect(fuzzyFilter(SAMPLE_METRICS, "   ")).toEqual(SAMPLE_METRICS);
  });

  it("returns exact substring matches", () => {
    const result = fuzzyFilter(SAMPLE_METRICS, "loss");
    expect(result).toContain("train/loss");
    expect(result).toContain("val/loss");
    expect(result).not.toContain("train/accuracy");
  });

  it("handles typos — 'lloss' still matches loss metrics", () => {
    const result = fuzzyFilter(SAMPLE_METRICS, "lloss");
    expect(result.some((r) => r.includes("loss"))).toBe(true);
  });

  it("handles trailing spaces — 'loss ' still matches", () => {
    const result = fuzzyFilter(SAMPLE_METRICS, "loss ");
    expect(result.some((r) => r.includes("loss"))).toBe(true);
  });

  it("handles transpositions — 'lsos' matches loss metrics", () => {
    const result = fuzzyFilter(SAMPLE_METRICS, "lsos");
    expect(result.some((r) => r.includes("loss"))).toBe(true);
  });

  it("is case insensitive — 'LOSS' matches lowercase items", () => {
    const result = fuzzyFilter(SAMPLE_METRICS, "LOSS");
    expect(result).toContain("train/loss");
    expect(result).toContain("val/loss");
  });

  it("returns empty array for completely unrelated query", () => {
    const result = fuzzyFilter(SAMPLE_METRICS, "zzzzzzzzz");
    expect(result).toEqual([]);
  });

  it("matches partial paths — 'tran/los' matches train/loss", () => {
    const result = fuzzyFilter(SAMPLE_METRICS, "tran/los");
    expect(result).toContain("train/loss");
  });
});

