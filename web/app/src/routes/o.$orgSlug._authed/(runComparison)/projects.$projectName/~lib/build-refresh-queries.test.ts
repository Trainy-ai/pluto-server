import { describe, it, expect } from "vitest";
import type { Query } from "@tanstack/react-query";
import { buildRefreshQueryFilters } from "./build-refresh-queries";

// Build a fake Query object with just enough shape for the predicates.
// tRPC v11 query keys look like [path[], { input, type }].
function makeQuery(
  path: string[],
  input?: Record<string, unknown>,
): Query {
  return {
    queryKey: [path, { input, type: "query" }],
  } as unknown as Query;
}

describe("buildRefreshQueryFilters", () => {
  const filters = buildRefreshQueryFilters();

  it("returns one filter with refetchType 'active'", () => {
    expect(filters).toHaveLength(1);
    expect(filters[0].refetchType).toBe("active");
  });

  it("matches every runs.* query", () => {
    const pred = filters[0].predicate!;
    expect(pred(makeQuery(["runs", "list"]))).toBe(true);
    expect(pred(makeQuery(["runs", "count"]))).toBe(true);
    expect(pred(makeQuery(["runs", "distinctFileLogNames"]))).toBe(true);
    expect(pred(makeQuery(["runs", "graphMultiMetricBatchBucketed"]))).toBe(true);
    expect(
      pred(makeQuery(["runs", "distinctMetricNames"], { regex: "train/.*" })),
    ).toBe(true);
  });

  it("does not match other namespaces", () => {
    const pred = filters[0].predicate!;
    expect(pred(makeQuery(["runTableViews", "list"]))).toBe(false);
    expect(pred(makeQuery(["dashboardViews", "list"]))).toBe(false);
  });

  it("tolerates malformed query keys", () => {
    const pred = filters[0].predicate!;
    const malformed = { queryKey: ["not-an-array"] } as unknown as Query;
    expect(pred(malformed)).toBe(false);
  });
});
