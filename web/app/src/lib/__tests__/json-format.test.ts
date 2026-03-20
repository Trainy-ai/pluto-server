import { describe, it, expect } from "vitest";
import { isJsonString, tryPrettyPrintJson } from "../json-format";

describe("isJsonString", () => {
  it("returns true for valid JSON objects", () => {
    expect(isJsonString('{"key": "value"}')).toBe(true);
  });

  it("returns true for valid JSON arrays", () => {
    expect(isJsonString('[1, 2, 3]')).toBe(true);
  });

  it("returns false for plain strings", () => {
    expect(isJsonString("hello")).toBe(false);
  });

  it("returns false for numbers", () => {
    expect(isJsonString("42")).toBe(false);
  });

  it("returns false for empty strings", () => {
    expect(isJsonString("")).toBe(false);
  });

  it("returns true for Python-style single-quoted dicts", () => {
    expect(isJsonString("{'key': 'value'}")).toBe(true);
  });

  it("returns true for Python-style single-quoted arrays", () => {
    expect(isJsonString("['a', 'b', 'c']")).toBe(true);
  });

  it("returns true for Python-style with True/False/None", () => {
    expect(isJsonString("{'enabled': True, 'value': None}")).toBe(true);
  });
});

describe("tryPrettyPrintJson", () => {
  it("pretty-prints valid JSON objects", () => {
    const input = '{"name":"foo","count":3}';
    const expected = JSON.stringify({ name: "foo", count: 3 }, null, 2);
    expect(tryPrettyPrintJson(input)).toBe(expected);
  });

  it("pretty-prints valid JSON arrays", () => {
    const input = '[{"a":1},{"a":2}]';
    const expected = JSON.stringify([{ a: 1 }, { a: 2 }], null, 2);
    expect(tryPrettyPrintJson(input)).toBe(expected);
  });

  it("returns original string for non-JSON values", () => {
    expect(tryPrettyPrintJson("hello world")).toBe("hello world");
    expect(tryPrettyPrintJson("42")).toBe("42");
  });

  it("pretty-prints Python single-quoted dicts", () => {
    const input = "{'path': 'acme/dataset-eval', 'name': 'LOOP_CITY-5T', 'split': 'valid'}";
    const result = tryPrettyPrintJson(input);
    expect(result).toContain("\n");
    expect(result).toContain('"path"');
    expect(result).toContain('"acme/dataset-eval"');
  });

  it("pretty-prints Python single-quoted arrays", () => {
    const input = "['linear:tag-1879']";
    const result = tryPrettyPrintJson(input);
    const expected = JSON.stringify(["linear:tag-1879"], null, 2);
    expect(result).toBe(expected);
  });

  it("pretty-prints Python arrays with multiple elements", () => {
    const input = "['linear:TAG-17B4', 'horizon_ablation', 'h128', 'ps32']";
    const result = tryPrettyPrintJson(input);
    expect(result).toContain("\n");
    expect(result).toContain('"linear:TAG-17B4"');
    expect(result).toContain('"ps32"');
  });

  it("handles Python True/False/None", () => {
    const input = "{'enabled': True, 'debug': False, 'value': None}";
    const result = tryPrettyPrintJson(input);
    expect(result).toContain("\n");
    expect(result).toContain('"enabled": true');
    expect(result).toContain('"debug": false');
    expect(result).toContain('"value": null');
  });

  it("handles Python array of dicts (realistic config)", () => {
    const input =
      "[{'path': 'acme/dataset-eval', 'name': 'LOOP_CITY-5T', 'split': 'valid'}, {'path': 'acme/dataset-eval', 'name': 'MODEL_A', 'split': 'valid'}]";
    const result = tryPrettyPrintJson(input);
    expect(result).toContain("\n");
    expect(result).toContain('"LOOP_CITY-5T"');
    expect(result).toContain('"MODEL_A"');
  });

  it("handles escaped single quotes inside Python strings", () => {
    const input = "{'msg': 'it\\'s fine'}";
    const result = tryPrettyPrintJson(input);
    expect(result).toContain("it's fine");
  });

  it("handles double quotes inside Python single-quoted strings", () => {
    const input = `{'msg': 'say "hello"'}`;
    const result = tryPrettyPrintJson(input);
    expect(result).toContain('say \\"hello\\"');
  });

  it("returns original for malformed Python-like strings", () => {
    const input = "{'key': 'unclosed";
    expect(tryPrettyPrintJson(input)).toBe(input);
  });
});
