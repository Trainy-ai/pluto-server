import { describe, it, expect } from "vitest";
import type { Query } from "@tanstack/react-query";
import {
  buildRefreshQueryFilters,
  isSideBySideQuery,
} from "./build-refresh-queries";

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

describe("isSideBySideQuery", () => {
  it("matches runs.list, count, getByIds, metricSummaries, distinctTags", () => {
    expect(isSideBySideQuery(makeQuery(["runs", "list"]))).toBe(true);
    expect(isSideBySideQuery(makeQuery(["runs", "count"]))).toBe(true);
    expect(isSideBySideQuery(makeQuery(["runs", "getByIds"]))).toBe(true);
    expect(isSideBySideQuery(makeQuery(["runs", "metricSummaries"]))).toBe(true);
    expect(isSideBySideQuery(makeQuery(["runs", "distinctTags"]))).toBe(true);
  });

  it("matches runs.distinctMetricNames only when input has no regex/search", () => {
    // Side-by-side's useRunMetricNames: runIds only
    expect(
      isSideBySideQuery(
        makeQuery(["runs", "distinctMetricNames"], { runIds: ["a", "b"] }),
      ),
    ).toBe(true);
    // Project-wide scan (useDistinctMetricNames): no input key at all
    expect(
      isSideBySideQuery(makeQuery(["runs", "distinctMetricNames"], {})),
    ).toBe(true);

    // Dashboard widget variants — these belong to the unmounted chart tree
    expect(
      isSideBySideQuery(
        makeQuery(["runs", "distinctMetricNames"], {
          runIds: ["a"],
          regex: "validation/.*",
        }),
      ),
    ).toBe(false);
    expect(
      isSideBySideQuery(
        makeQuery(["runs", "distinctMetricNames"], {
          runIds: ["a"],
          search: "loss",
        }),
      ),
    ).toBe(false);
  });

  it("rejects dashboard-only queries", () => {
    expect(isSideBySideQuery(makeQuery(["runs", "distinctFileLogNames"]))).toBe(
      false,
    );
    expect(
      isSideBySideQuery(makeQuery(["runs", "distinctColumnKeys"])),
    ).toBe(false);
    expect(
      isSideBySideQuery(makeQuery(["runs", "graphMultiMetricBatchBucketed"])),
    ).toBe(false);
  });

  it("rejects non-runs namespaces", () => {
    expect(isSideBySideQuery(makeQuery(["runTableViews", "list"]))).toBe(false);
    expect(isSideBySideQuery(makeQuery(["dashboardViews", "list"]))).toBe(false);
  });

  it("tolerates malformed query keys", () => {
    const malformed = { queryKey: ["not-an-array"] } as unknown as Query;
    expect(isSideBySideQuery(malformed)).toBe(false);
  });
});

describe("buildRefreshQueryFilters", () => {
  describe("charts mode", () => {
    const filters = buildRefreshQueryFilters("charts");

    it("returns two filters: runs.list (active) and everything-else-runs (all)", () => {
      expect(filters).toHaveLength(2);
      expect(filters[0].refetchType).toBe("active");
      expect(filters[1].refetchType).toBe("all");
    });

    it("first filter matches runs.list only", () => {
      const pred = filters[0].predicate!;
      expect(pred(makeQuery(["runs", "list"]))).toBe(true);
      expect(pred(makeQuery(["runs", "count"]))).toBe(false);
      expect(pred(makeQuery(["dashboardViews", "list"]))).toBe(false);
    });

    it("second filter matches every runs.* except list", () => {
      const pred = filters[1].predicate!;
      expect(pred(makeQuery(["runs", "count"]))).toBe(true);
      expect(pred(makeQuery(["runs", "distinctFileLogNames"]))).toBe(true);
      expect(
        pred(
          makeQuery(["runs", "distinctMetricNames"], { regex: "train/.*" }),
        ),
      ).toBe(true);
      expect(pred(makeQuery(["runs", "list"]))).toBe(false);
      expect(pred(makeQuery(["runTableViews", "list"]))).toBe(false);
    });
  });

  describe("side-by-side mode", () => {
    const filters = buildRefreshQueryFilters("side-by-side");

    it("returns two filters: runs.list (active) and narrow-runs (all)", () => {
      expect(filters).toHaveLength(2);
      expect(filters[0].refetchType).toBe("active");
      expect(filters[1].refetchType).toBe("all");
    });

    it("first filter still matches runs.list only", () => {
      const pred = filters[0].predicate!;
      expect(pred(makeQuery(["runs", "list"]))).toBe(true);
      expect(pred(makeQuery(["runs", "count"]))).toBe(false);
    });

    it("second filter only matches side-by-side's observed queries (excluding list)", () => {
      const pred = filters[1].predicate!;
      // Included
      expect(pred(makeQuery(["runs", "count"]))).toBe(true);
      expect(pred(makeQuery(["runs", "getByIds"]))).toBe(true);
      expect(pred(makeQuery(["runs", "metricSummaries"]))).toBe(true);
      expect(pred(makeQuery(["runs", "distinctTags"]))).toBe(true);
      expect(
        pred(makeQuery(["runs", "distinctMetricNames"], { runIds: ["a"] })),
      ).toBe(true);
      // Excluded — runs.list is the separate "active" filter, not this one
      expect(pred(makeQuery(["runs", "list"]))).toBe(false);
      // Excluded — dashboard-only
      expect(pred(makeQuery(["runs", "distinctFileLogNames"]))).toBe(false);
      expect(
        pred(
          makeQuery(["runs", "distinctMetricNames"], { regex: "train/.*" }),
        ),
      ).toBe(false);
      expect(
        pred(
          makeQuery(["runs", "distinctMetricNames"], { search: "loss" }),
        ),
      ).toBe(false);
      expect(pred(makeQuery(["runs", "graphMultiMetricBatchBucketed"]))).toBe(
        false,
      );
    });
  });
});
