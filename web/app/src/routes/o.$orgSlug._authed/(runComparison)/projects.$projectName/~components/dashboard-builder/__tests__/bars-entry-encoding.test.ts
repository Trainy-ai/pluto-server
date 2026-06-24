import { describe, it, expect } from "vitest";
import {
  CATEGORICAL_BARS_SUFFIX,
  encodeBarsEntry,
  isBarsEntry,
  decodeBarsEntry,
} from "../bars-entry-encoding";

describe("encodeBarsEntry", () => {
  it("appends the {bars} suffix to a prefix", () => {
    expect(encodeBarsEntry("training/dataset/")).toBe(
      `training/dataset/${CATEGORICAL_BARS_SUFFIX}`,
    );
  });

  it("doesn't add trailing slashes (preserves caller's prefix exactly)", () => {
    expect(encodeBarsEntry("foo/bar")).toBe(`foo/bar${CATEGORICAL_BARS_SUFFIX}`);
  });
});

describe("isBarsEntry", () => {
  it("returns true for any string ending in {bars}", () => {
    expect(isBarsEntry("training/dataset/{bars}")).toBe(true);
    expect(isBarsEntry("foo{bars}")).toBe(true);
  });

  it("returns false for plain file names", () => {
    expect(isBarsEntry("distributions/gradients")).toBe(false);
    expect(isBarsEntry("training/dataset/dataset1")).toBe(false);
  });

  it("returns false for the suffix as a substring (not at the end)", () => {
    expect(isBarsEntry("{bars}/leftover")).toBe(false);
  });
});

describe("decodeBarsEntry", () => {
  it("strips the suffix from a {bars} entry", () => {
    expect(decodeBarsEntry("training/dataset/{bars}")).toBe("training/dataset/");
  });

  it("returns non-{bars} values unchanged (no-op for plain files)", () => {
    expect(decodeBarsEntry("distributions/gradients")).toBe("distributions/gradients");
  });
});
