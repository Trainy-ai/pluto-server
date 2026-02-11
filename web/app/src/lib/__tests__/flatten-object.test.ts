/**
 * Unit tests for flattenObject and formatValue.
 *
 * When a user logs a training run, they can attach arbitrary nested JSON as
 * "config" (hyperparameters like { optimizer: { lr: 0.01 } }) and
 * "systemMetadata" (machine info like { gpu: { name: "A100", count: 4 } }).
 *
 * The run table needs to show each nested field as its own column. flattenObject
 * converts nested JSON into flat dot-notation keys so the table can create a
 * column for each one:
 *   { optimizer: { lr: 0.01 } }  -->  { "optimizer.lr": 0.01 }
 *
 * formatValue then takes the raw cell value and turns it into a readable string
 * for display (e.g. null → "-", 1000 → "1,000", [1,2] → "[1,2]").
 *
 * Both are used in the columns.tsx file that defines the run table columns.
 */

import { describe, it, expect } from "vitest";
import { flattenObject, formatValue } from "../flatten-object";

describe("flattenObject", () => {
  // --- Basic cases ---

  it("returns an empty object when given null", () => {
    // null input should be treated as "nothing to flatten"
    expect(flattenObject(null)).toEqual({});
  });

  it("returns an empty object when given undefined", () => {
    expect(flattenObject(undefined)).toEqual({});
  });

  it("returns the same keys for a flat object (no nesting)", () => {
    // A single-level object should pass through unchanged
    const input = { name: "run-1", status: "RUNNING" };
    expect(flattenObject(input)).toEqual({ name: "run-1", status: "RUNNING" });
  });

  // --- Nested objects ---

  it("flattens one level of nesting into dot-notation keys", () => {
    // { optimizer: { lr: 0.01 } } should become { "optimizer.lr": 0.01 }
    const input = { optimizer: { lr: 0.01, type: "adam" } };
    expect(flattenObject(input)).toEqual({
      "optimizer.lr": 0.01,
      "optimizer.type": "adam",
    });
  });

  it("flattens deeply nested objects (3+ levels)", () => {
    // Configs can be arbitrarily nested; all leaves should surface
    const input = { a: { b: { c: { d: 42 } } } };
    expect(flattenObject(input)).toEqual({ "a.b.c.d": 42 });
  });

  it("handles mixed flat and nested keys", () => {
    // Some keys are simple values, others are nested objects
    const input = { name: "run-1", config: { lr: 0.01 } };
    const result = flattenObject(input);
    expect(result).toEqual({ name: "run-1", "config.lr": 0.01 });
  });

  // --- Arrays (should be treated as leaf values, not recursed into) ---

  it("preserves arrays as leaf values without recursing into them", () => {
    // Arrays like tags or layer sizes should stay as-is
    const input = { layers: [128, 64, 32] };
    expect(flattenObject(input)).toEqual({ layers: [128, 64, 32] });
  });

  it("preserves arrays nested inside objects", () => {
    const input = { model: { layers: [128, 64] } };
    expect(flattenObject(input)).toEqual({ "model.layers": [128, 64] });
  });

  // --- Prefix parameter ---

  it("prepends the prefix to all keys when provided", () => {
    // The prefix is used when recursing, but can also be called directly
    const input = { lr: 0.01 };
    expect(flattenObject(input, "config")).toEqual({ "config.lr": 0.01 });
  });

  // --- Edge cases ---

  it("returns an empty object for an empty object input", () => {
    expect(flattenObject({})).toEqual({});
  });

  it("handles a non-object primitive with a prefix", () => {
    // When called with a primitive and a prefix (happens during recursion),
    // the primitive is stored under the prefix key
    expect(flattenObject(42, "value")).toEqual({ value: 42 });
  });

  it("handles a non-object primitive without a prefix", () => {
    // No prefix means no key to store under, so result is empty
    expect(flattenObject(42)).toEqual({});
  });

  it("handles null values inside objects", () => {
    // Null leaf values should be preserved as-is
    const input = { a: null, b: { c: null } };
    expect(flattenObject(input)).toEqual({ a: null, "b.c": null });
  });
});

describe("formatValue", () => {
  // --- Null/undefined ---

  it("returns dash for null", () => {
    // Missing values display as a dash in the table
    expect(formatValue(null)).toBe("-");
  });

  it("returns dash for undefined", () => {
    expect(formatValue(undefined)).toBe("-");
  });

  // --- Booleans ---

  it("formats true as 'true'", () => {
    expect(formatValue(true)).toBe("true");
  });

  it("formats false as 'false'", () => {
    expect(formatValue(false)).toBe("false");
  });

  // --- Numbers ---

  it("formats integers with locale separators", () => {
    // 1000 should get locale formatting (e.g. "1,000" in en-US)
    const result = formatValue(1000);
    // Just check it contains "1" and "000" - locale format varies
    expect(result).toContain("1");
    expect(result).toContain("000");
  });

  it("formats floats with up to 6 decimal places", () => {
    // Floats should be capped at 6 decimal places
    const result = formatValue(3.141592653589);
    expect(result).toContain("3");
    // Should not have more than 6 decimal digits
    const decimalPart = result.split(".")[1] || "";
    expect(decimalPart.length).toBeLessThanOrEqual(6);
  });

  it("formats zero as '0'", () => {
    expect(formatValue(0)).toBe("0");
  });

  // --- Arrays ---

  it("formats arrays as JSON strings", () => {
    expect(formatValue([1, 2, 3])).toBe("[1,2,3]");
  });

  it("formats empty arrays as '[]'", () => {
    expect(formatValue([])).toBe("[]");
  });

  // --- Objects ---

  it("formats objects as JSON strings", () => {
    expect(formatValue({ a: 1 })).toBe('{"a":1}');
  });

  // --- Strings ---

  it("returns strings as-is", () => {
    expect(formatValue("hello")).toBe("hello");
  });

  it("returns empty string as-is", () => {
    expect(formatValue("")).toBe("");
  });
});
