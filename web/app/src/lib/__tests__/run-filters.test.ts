/**
 * Unit tests for the run filter system (run-filters.ts).
 *
 * The run table has a filter bar where users can add filters like
 * "Status is any of RUNNING, FAILED" or "config.lr > 0.01". All filters
 * are server-side — they get sent as query params to the backend so the
 * database only returns matching runs. This ensures filters work across
 * all runs in the project, not just the currently loaded pages.
 *
 * This file tests the pure functions that handle:
 *   - getOperatorsForType: what operators to show in the filter dropdown
 *   - getDefaultOperator: which operator to pre-select for each data type
 *   - extractServerFilters: converting frontend filters into the API format
 *   - formatFilterChip: generating display text for the active filter chips
 */

import { describe, it, expect } from "vitest";
import {
  getOperatorsForType,
  getDefaultOperator,
  extractServerFilters,
  formatFilterChip,
  type RunFilter,
} from "../run-filters";

// ---------------------------------------------------------------------------
// getOperatorsForType
// ---------------------------------------------------------------------------

describe("getOperatorsForType", () => {
  it("returns text operators (contains, does not contain)", () => {
    const ops = getOperatorsForType("text");
    const values = ops.map((o) => o.value);

    // Text columns support substring matching
    expect(values).toContain("contains");
    expect(values).toContain("does not contain");
    expect(ops.length).toBe(2);
  });

  it("returns number operators including comparisons and ranges", () => {
    const ops = getOperatorsForType("number");
    const values = ops.map((o) => o.value);

    // Number columns support equality, comparisons, and range operators
    expect(values).toContain("is");
    expect(values).toContain("is not");
    expect(values).toContain("is greater than");
    expect(values).toContain("is less than");
    expect(values).toContain("is between");
  });

  it("returns date operators including before/after/between", () => {
    const ops = getOperatorsForType("date");
    const values = ops.map((o) => o.value);

    expect(values).toContain("is before");
    expect(values).toContain("is after");
    expect(values).toContain("is between");
    expect(values).toContain("is on or after");
    expect(values).toContain("is on or before");
  });

  it("returns option operators (is, is not, is any of, is none of)", () => {
    const ops = getOperatorsForType("option");
    const values = ops.map((o) => o.value);

    // Option columns (like Status) support single and multi-select
    expect(values).toContain("is");
    expect(values).toContain("is not");
    expect(values).toContain("is any of");
    expect(values).toContain("is none of");
  });

  it("returns multiOption operators (include, exclude, etc.)", () => {
    const ops = getOperatorsForType("multiOption");
    const values = ops.map((o) => o.value);

    // MultiOption columns (like Tags) support set operations
    expect(values).toContain("include");
    expect(values).toContain("exclude");
    expect(values).toContain("include any of");
    expect(values).toContain("include all of");
  });
});

// ---------------------------------------------------------------------------
// getDefaultOperator
// ---------------------------------------------------------------------------

describe("getDefaultOperator", () => {
  // Each data type has a sensible default operator used when the user first
  // adds a filter — before choosing a specific operator from the dropdown.

  it("defaults to 'contains' for text", () => {
    expect(getDefaultOperator("text")).toBe("contains");
  });

  it("defaults to 'is' for number", () => {
    expect(getDefaultOperator("number")).toBe("is");
  });

  it("defaults to 'is after' for date", () => {
    expect(getDefaultOperator("date")).toBe("is after");
  });

  it("defaults to 'is any of' for option", () => {
    expect(getDefaultOperator("option")).toBe("is any of");
  });

  it("defaults to 'include any of' for multiOption", () => {
    expect(getDefaultOperator("multiOption")).toBe("include any of");
  });
});

// ---------------------------------------------------------------------------
// extractServerFilters
// ---------------------------------------------------------------------------

describe("extractServerFilters", () => {
  // extractServerFilters takes the full filter list and converts them into
  // the backend API format: status[], tags[], dateFilters[], fieldFilters[],
  // metricFilters[], and systemFilters[].

  it("returns empty object when no filters are provided", () => {
    expect(extractServerFilters([])).toEqual({});
  });

  it("extracts status values from status filters", () => {
    const filters: RunFilter[] = [
      {
        id: "1",
        field: "status",
        source: "system",
        dataType: "option",
        operator: "is any of",
        values: ["RUNNING", "FAILED"],
      },
    ];
    const result = extractServerFilters(filters);
    expect(result.status).toEqual(["RUNNING", "FAILED"]);
  });

  it("extracts tag values from tags filters", () => {
    // Tags use multiOption format where values[0] is an array of selected tags
    const filters: RunFilter[] = [
      {
        id: "2",
        field: "tags",
        source: "system",
        dataType: "multiOption",
        operator: "include any of",
        values: [["v1", "production"]],
      },
    ];
    const result = extractServerFilters(filters);
    expect(result.tags).toEqual(["v1", "production"]);
  });

  it("maps 'is before' to backend 'before' operator", () => {
    const filters: RunFilter[] = [
      {
        id: "3",
        field: "createdAt",
        source: "system",
        dataType: "date",
        operator: "is before",
        values: ["2024-06-01T00:00:00.000Z"],
      },
    ];
    const result = extractServerFilters(filters);

    // The frontend uses "is before" but the backend API expects "before"
    expect(result.dateFilters).toHaveLength(1);
    expect(result.dateFilters![0].operator).toBe("before");
    expect(result.dateFilters![0].field).toBe("createdAt");
  });

  it("maps 'is after' to backend 'after' operator", () => {
    const filters: RunFilter[] = [
      {
        id: "4",
        field: "updatedAt",
        source: "system",
        dataType: "date",
        operator: "is after",
        values: ["2024-01-01T00:00:00.000Z"],
      },
    ];
    const result = extractServerFilters(filters);
    expect(result.dateFilters![0].operator).toBe("after");
    expect(result.dateFilters![0].field).toBe("updatedAt");
  });

  it("maps 'is on or before' to 'before'", () => {
    const filters: RunFilter[] = [
      {
        id: "5",
        field: "statusUpdated",
        source: "system",
        dataType: "date",
        operator: "is on or before",
        values: ["2024-06-01T00:00:00.000Z"],
      },
    ];
    const result = extractServerFilters(filters);
    expect(result.dateFilters![0].operator).toBe("before");
  });

  it("maps 'is on or after' to 'after'", () => {
    const filters: RunFilter[] = [
      {
        id: "6",
        field: "createdAt",
        source: "system",
        dataType: "date",
        operator: "is on or after",
        values: ["2024-01-01T00:00:00.000Z"],
      },
    ];
    const result = extractServerFilters(filters);
    expect(result.dateFilters![0].operator).toBe("after");
  });

  it("maps 'is between' and includes both date values", () => {
    const filters: RunFilter[] = [
      {
        id: "7",
        field: "createdAt",
        source: "system",
        dataType: "date",
        operator: "is between",
        values: ["2024-01-01T00:00:00.000Z", "2024-06-01T00:00:00.000Z"],
      },
    ];
    const result = extractServerFilters(filters);
    expect(result.dateFilters![0].operator).toBe("between");
    expect(result.dateFilters![0].value).toBe("2024-01-01T00:00:00.000Z");
    expect(result.dateFilters![0].value2).toBe("2024-06-01T00:00:00.000Z");
  });

  it("extracts name and config filters into systemFilters and fieldFilters", () => {
    const filters: RunFilter[] = [
      {
        id: "8",
        field: "name",
        source: "system",
        dataType: "text",
        operator: "contains",
        values: ["experiment"],
      },
      {
        id: "9",
        field: "lr",
        source: "config",
        dataType: "number",
        operator: "is",
        values: [0.01],
      },
    ];
    const result = extractServerFilters(filters);

    // Name filter should appear in systemFilters
    expect(result.systemFilters).toHaveLength(1);
    expect(result.systemFilters![0].field).toBe("name");
    expect(result.systemFilters![0].operator).toBe("contains");
    // Config filter should appear in fieldFilters
    expect(result.fieldFilters).toHaveLength(1);
    expect(result.fieldFilters![0].key).toBe("lr");
  });

  it("handles a mix of different filter types", () => {
    const filters: RunFilter[] = [
      {
        id: "1",
        field: "status",
        source: "system",
        dataType: "option",
        operator: "is any of",
        values: ["COMPLETED"],
      },
      {
        id: "2",
        field: "name",
        source: "system",
        dataType: "text",
        operator: "contains",
        values: ["test"],
      },
      {
        id: "3",
        field: "createdAt",
        source: "system",
        dataType: "date",
        operator: "is after",
        values: ["2024-01-01T00:00:00.000Z"],
      },
    ];
    const result = extractServerFilters(filters);

    expect(result.status).toEqual(["COMPLETED"]);
    expect(result.dateFilters).toHaveLength(1);
    // Name and status both appear in systemFilters
    expect(result.systemFilters).toHaveLength(2);
    // Tags should not be set since there are no tag filters
    expect(result.tags).toBeUndefined();
  });

  it("skips date filters with unrecognized operators", () => {
    // "is" and "is not" are valid date operators in the UI but don't map
    // to a backend date filter operator, so they should be skipped
    const filters: RunFilter[] = [
      {
        id: "10",
        field: "createdAt",
        source: "system",
        dataType: "date",
        operator: "is",
        values: ["2024-01-01T00:00:00.000Z"],
      },
    ];
    const result = extractServerFilters(filters);

    // "is" doesn't map to before/after/between, so no dateFilters
    expect(result.dateFilters).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// formatFilterChip
// ---------------------------------------------------------------------------

describe("formatFilterChip", () => {
  // formatFilterChip generates the display text for the small filter chips
  // that appear above the table (e.g. "Status is any of RUNNING, FAILED")

  it("formats a system field with its display label", () => {
    // The Status field should use the label "Status", not the raw field name
    const filter: RunFilter = {
      id: "1",
      field: "status",
      source: "system",
      dataType: "option",
      operator: "is any of",
      values: ["RUNNING", "FAILED"],
    };
    const chip = formatFilterChip(filter);
    expect(chip).toContain("Status");
    expect(chip).toContain("is any of");
    expect(chip).toContain("RUNNING");
    expect(chip).toContain("FAILED");
  });

  it("formats 'exists' operator without values", () => {
    const filter: RunFilter = {
      id: "2",
      field: "lr",
      source: "config",
      dataType: "number",
      operator: "exists",
      values: [],
    };
    expect(formatFilterChip(filter)).toBe("lr exists");
  });

  it("formats 'not exists' operator without values", () => {
    const filter: RunFilter = {
      id: "3",
      field: "lr",
      source: "config",
      dataType: "number",
      operator: "not exists",
      values: [],
    };
    expect(formatFilterChip(filter)).toBe("lr not exists");
  });

  it("truncates to 'N values' when more than 2 values", () => {
    // When there are many selected values, the chip shouldn't be huge
    const filter: RunFilter = {
      id: "4",
      field: "status",
      source: "system",
      dataType: "option",
      operator: "is any of",
      values: ["RUNNING", "COMPLETED", "FAILED"],
    };
    const chip = formatFilterChip(filter);
    expect(chip).toContain("3 values");
  });

  it("shows individual values when 2 or fewer", () => {
    const filter: RunFilter = {
      id: "5",
      field: "status",
      source: "system",
      dataType: "option",
      operator: "is any of",
      values: ["RUNNING"],
    };
    const chip = formatFilterChip(filter);
    expect(chip).toContain("RUNNING");
    expect(chip).not.toContain("values");
  });

  it("formats date filter with local date string", () => {
    const filter: RunFilter = {
      id: "6",
      field: "createdAt",
      source: "system",
      dataType: "date",
      operator: "is after",
      values: ["2024-06-15T00:00:00.000Z"],
    };
    const chip = formatFilterChip(filter);

    // Should contain the field label "Created" and the operator
    expect(chip).toContain("Created");
    expect(chip).toContain("is after");
    // Should contain a formatted date (month/day/year)
    expect(chip).toMatch(/\d+\/\d+\/\d+/);
  });

  it("formats 'is between' date range with separator", () => {
    const filter: RunFilter = {
      id: "7",
      field: "createdAt",
      source: "system",
      dataType: "date",
      operator: "is between",
      values: ["2024-01-01T00:00:00.000Z", "2024-06-01T00:00:00.000Z"],
    };
    const chip = formatFilterChip(filter);

    expect(chip).toContain("Created");
    expect(chip).toContain("between");
    // Should have an en-dash separator between the two dates
    expect(chip).toContain("–");
  });

  it("falls back to raw field name for non-system fields", () => {
    // Config fields don't have a label in SYSTEM_FILTERABLE_FIELDS,
    // so the chip should use the raw field key
    const filter: RunFilter = {
      id: "8",
      field: "learning_rate",
      source: "config",
      dataType: "number",
      operator: "is",
      values: [0.01],
    };
    const chip = formatFilterChip(filter);
    expect(chip).toContain("learning_rate");
  });

  it("formats multiOption with nested array values", () => {
    const filter: RunFilter = {
      id: "9",
      field: "tags",
      source: "system",
      dataType: "multiOption",
      operator: "include any of",
      values: [["v1", "v2"]],
    };
    const chip = formatFilterChip(filter);
    expect(chip).toContain("Tags");
    expect(chip).toContain("v1");
    expect(chip).toContain("v2");
  });

  it("truncates multiOption to 'N values' when more than 2", () => {
    const filter: RunFilter = {
      id: "10",
      field: "tags",
      source: "system",
      dataType: "multiOption",
      operator: "include any of",
      values: [["v1", "v2", "v3"]],
    };
    const chip = formatFilterChip(filter);
    expect(chip).toContain("3 values");
  });

  it("returns field + operator when values array is empty", () => {
    const filter: RunFilter = {
      id: "11",
      field: "name",
      source: "system",
      dataType: "text",
      operator: "contains",
      values: [],
    };
    const chip = formatFilterChip(filter);
    expect(chip).toBe("Name contains");
  });
});
