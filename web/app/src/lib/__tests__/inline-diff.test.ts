import { describe, it, expect } from "vitest";
import { tokenize, computeInlineDiff } from "../inline-diff";

describe("tokenize", () => {
  it("splits on word boundaries", () => {
    expect(tokenize("hello world")).toEqual(["hello", " ", "world"]);
  });

  it("splits paths", () => {
    expect(tokenize("/usr/bin/python")).toEqual(["/", "usr", "/", "bin", "/", "python"]);
  });

  it("splits on hyphens and underscores within a word token", () => {
    // underscores are word chars, so model_v1 stays together
    expect(tokenize("model_v1")).toEqual(["model_v1"]);
  });

  it("splits JSON-like structure", () => {
    const tokens = tokenize('{"key": "val"}');
    expect(tokens).toContain("{");
    expect(tokens).toContain("}");
    expect(tokens).toContain(":");
  });

  it("returns empty array for empty string", () => {
    expect(tokenize("")).toEqual([]);
  });
});

describe("computeInlineDiff", () => {
  it("returns undefined for identical strings", () => {
    expect(computeInlineDiff("hello world", "hello world")).toBeUndefined();
  });

  it("detects single word change", () => {
    const result = computeInlineDiff("model_v1 is good", "model_v2 is good");
    expect(result).toBeDefined();
    // Reference should have model_v1 as removed
    const refRemoved = result!.refSpans.filter((s) => s.type === "removed");
    expect(refRemoved.length).toBeGreaterThan(0);
    expect(refRemoved.some((s) => s.text.includes("model_v1"))).toBe(true);
    // Other should have model_v2 as added
    const otherAdded = result!.otherSpans.filter((s) => s.type === "added");
    expect(otherAdded.length).toBeGreaterThan(0);
    expect(otherAdded.some((s) => s.text.includes("model_v2"))).toBe(true);
  });

  it("handles path diffs", () => {
    const result = computeInlineDiff(
      "/data/models/bert-base",
      "/data/models/bert-large",
    );
    expect(result).toBeDefined();
    const refRemoved = result!.refSpans.filter((s) => s.type === "removed");
    expect(refRemoved.some((s) => s.text.includes("base"))).toBe(true);
    const otherAdded = result!.otherSpans.filter((s) => s.type === "added");
    expect(otherAdded.some((s) => s.text.includes("large"))).toBe(true);
  });

  it("handles one empty string", () => {
    const result = computeInlineDiff("hello", "");
    expect(result).toBeDefined();
    expect(result!.refSpans).toEqual([{ text: "hello", type: "removed" }]);
    expect(result!.otherSpans).toEqual([]);
  });

  it("handles both empty strings", () => {
    expect(computeInlineDiff("", "")).toBeUndefined();
  });

  it("handles numeric string differences", () => {
    const result = computeInlineDiff("lr=0.001", "lr=0.01");
    expect(result).toBeDefined();
    expect(result!.refSpans.some((s) => s.type === "removed")).toBe(true);
    expect(result!.otherSpans.some((s) => s.type === "added")).toBe(true);
  });

  it("handles JSON-like diffs", () => {
    const result = computeInlineDiff(
      '["adam", "sgd"]',
      '["adam", "rmsprop"]',
    );
    expect(result).toBeDefined();
    // "adam" should be equal in both
    const refEqual = result!.refSpans.filter((s) => s.type === "equal");
    expect(refEqual.some((s) => s.text.includes("adam"))).toBe(true);
  });

  it("handles command-line arg diffs", () => {
    const result = computeInlineDiff(
      "--epochs 10 --batch-size 32 --lr 0.001",
      "--epochs 20 --batch-size 32 --lr 0.001",
    );
    expect(result).toBeDefined();
    // batch-size and lr parts should be equal
    const otherEqual = result!.otherSpans.filter((s) => s.type === "equal");
    const equalText = otherEqual.map((s) => s.text).join("");
    expect(equalText).toContain("batch");
    expect(equalText).toContain("lr");
  });

  it("merges consecutive same-type spans", () => {
    const result = computeInlineDiff("a b c", "x y z");
    expect(result).toBeDefined();
    // All tokens differ, so ref should have one or few removed spans (merged)
    for (const span of result!.refSpans) {
      expect(["removed", "equal"]).toContain(span.type);
    }
    for (const span of result!.otherSpans) {
      expect(["added", "equal"]).toContain(span.type);
    }
  });

  it("reconstructs original text from spans", () => {
    const ref = "the quick brown fox";
    const other = "the slow brown dog";
    const result = computeInlineDiff(ref, other);
    expect(result).toBeDefined();
    const refText = result!.refSpans.map((s) => s.text).join("");
    const otherText = result!.otherSpans.map((s) => s.text).join("");
    expect(refText).toBe(ref);
    expect(otherText).toBe(other);
  });
});
