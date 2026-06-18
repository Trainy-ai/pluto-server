import { describe, it, expect } from "vitest";
import {
  insertRawValueColumn,
  formatRawValueContent,
  formatMinMaxContent,
  formatValueContent,
  createPinHintRow,
  PIN_HINT_TEXT,
  type TooltipColumnConfig,
} from "../tooltip-plugin";
import { formatAxisLabel } from "../format";

const col = (
  id: TooltipColumnConfig["id"],
  enabled = true,
): TooltipColumnConfig => ({ id, label: id, enabled });

describe("insertRawValueColumn", () => {
  it("appends raw-value at the end of a typical column list", () => {
    const input = [col("run-name"), col("run-id"), col("metric"), col("value")];
    const result = insertRawValueColumn(input);
    expect(result.map((c) => c.id)).toEqual([
      "run-name",
      "run-id",
      "metric",
      "value",
      "raw-value",
    ]);
  });

  it("places raw-value at the END even when Value is not the last column", () => {
    // Order contract: raw-value must always be last so it never wedges
    // between Value and any user-reordered column following Value.
    const input = [col("run-name"), col("value"), col("run-id")];
    const result = insertRawValueColumn(input);
    expect(result.map((c) => c.id)).toEqual([
      "run-name",
      "value",
      "run-id",
      "raw-value",
    ]);
  });

  it("returns a single raw-value column when given an empty list", () => {
    const result = insertRawValueColumn([]);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      id: "raw-value",
      label: "Raw Value",
      enabled: true,
    });
  });

  it("does not mutate the input array", () => {
    const input = [col("value")];
    const inputCopy = [...input];
    insertRawValueColumn(input);
    expect(input).toEqual(inputCopy);
  });

  it("always marks the synthetic column enabled with label 'Raw Value'", () => {
    const result = insertRawValueColumn([col("value")]);
    const raw = result.find((c) => c.id === "raw-value");
    expect(raw).toEqual({
      id: "raw-value",
      label: "Raw Value",
      enabled: true,
    });
  });
});

// ── formatRawValueContent ────────────────────────────────────────────────────
// Renders one Raw Value tooltip cell. Validates that the right text + styles
// land on the span for each branch (raw value, raw flag, neither, both).

const TEXT_COLOR = "#fff";

const baseRow = {
  name: "test",
  value: 0,
  color: "",
  isHighlighted: false,
  isInterpolated: false,
};

describe("formatRawValueContent", () => {
  it("renders the formatted raw value when a finite raw is present", () => {
    const span = document.createElement("span");
    formatRawValueContent(span, { ...baseRow, rawValue: 0.234 }, TEXT_COLOR);
    expect(span.textContent).toBe(formatAxisLabel(0.234));
    expect(span.style.color).toBe("rgb(255, 255, 255)"); // jsdom normalises #fff
    expect(span.style.opacity).toBe("0.85");
    expect(span.style.fontStyle).toBe("");
  });

  it("renders an em-dash when rawValue is undefined", () => {
    const span = document.createElement("span");
    formatRawValueContent(span, baseRow, TEXT_COLOR);
    expect(span.textContent).toBe("—");
    expect(span.style.opacity).toBe("0.4");
  });

  it("renders an em-dash when rawValue is null", () => {
    // null comes from server-bucketed data with no value in the bucket.
    const span = document.createElement("span");
    formatRawValueContent(
      span,
      // The TooltipRowData type lists rawValue as `number | undefined`, but
      // at runtime null leaks through; guard against regression.
      { ...baseRow, rawValue: null as unknown as number | undefined },
      TEXT_COLOR,
    );
    expect(span.textContent).toBe("—");
    expect(span.style.opacity).toBe("0.4");
  });

  it("renders a non-finite flag in warning style when rawFlagText is set", () => {
    const span = document.createElement("span");
    formatRawValueContent(
      span,
      { ...baseRow, rawFlagText: "NaN" },
      TEXT_COLOR,
    );
    expect(span.textContent).toBe("NaN");
    expect(span.style.color).toBe("rgb(232, 168, 56)"); // #e8a838
    expect(span.style.fontWeight).toBe("600");
    expect(span.style.fontStyle).toBe("italic");
  });

  it("prefers rawFlagText over rawValue when both are set", () => {
    // A finite raw value plus a flag means the bucket had both — flag wins
    // because it carries the more important information (NaN/Inf occurred).
    const span = document.createElement("span");
    formatRawValueContent(
      span,
      { ...baseRow, rawValue: 0.5, rawFlagText: "Inf" },
      TEXT_COLOR,
    );
    expect(span.textContent).toBe("Inf");
    expect(span.style.color).toBe("rgb(232, 168, 56)");
  });

  it("clears stale styles when going from flag to em-dash on the same span", () => {
    // Real-world reuse: the fast-path updates the same span across hover
    // events. A previous flag render must not leak italic/bold into a later
    // em-dash render.
    const span = document.createElement("span");
    formatRawValueContent(
      span,
      { ...baseRow, rawFlagText: "NaN" },
      TEXT_COLOR,
    );
    formatRawValueContent(span, baseRow, TEXT_COLOR);
    expect(span.textContent).toBe("—");
    expect(span.style.fontStyle).toBe("");
    expect(span.style.fontWeight).toBe("");
  });

  it("renders 'hidden' warning when rowHidden is true (overrides numeric raw value)", () => {
    // Ensures the row-hidden state propagates into the Raw Value cell so the
    // user doesn't see stale numbers for a series they've toggled off.
    const span = document.createElement("span");
    formatRawValueContent(
      span,
      { ...baseRow, rowHidden: true, rawValue: 0.5 },
      TEXT_COLOR,
    );
    expect(span.textContent).toBe("hidden");
    expect(span.style.color).toBe("rgb(232, 168, 56)");
    expect(span.style.fontWeight).toBe("600");
    expect(span.style.fontStyle).toBe("italic");
  });
});

// ── formatMinMaxContent ─────────────────────────────────────────────────────
// Reads the min OR max envelope value off TooltipRowData and renders one cell.
// Falls back to em-dash when the requested envelope value is absent (e.g. raw
// individual-run charts have no buckets, so neither minValue nor maxValue is
// populated and the cell stays as "—").

describe("formatMinMaxContent", () => {
  it("renders the formatted min value when minValue is present and which='min'", () => {
    const span = document.createElement("span");
    formatMinMaxContent(
      span,
      { ...baseRow, minValue: 0.5, maxValue: 19.2 },
      TEXT_COLOR,
      "min",
    );
    expect(span.textContent).toBe(formatAxisLabel(0.5));
    expect(span.style.opacity).toBe("0.85");
    expect(span.style.fontStyle).toBe("");
  });

  it("renders the formatted max value when which='max'", () => {
    const span = document.createElement("span");
    formatMinMaxContent(
      span,
      { ...baseRow, minValue: 0.5, maxValue: 19.2 },
      TEXT_COLOR,
      "max",
    );
    expect(span.textContent).toBe(formatAxisLabel(19.2));
  });

  it("renders an em-dash when the requested side is missing", () => {
    const span = document.createElement("span");
    formatMinMaxContent(
      span,
      { ...baseRow, maxValue: 19.2 }, // no minValue
      TEXT_COLOR,
      "min",
    );
    expect(span.textContent).toBe("—");
    expect(span.style.opacity).toBe("0.4");
  });

  it("renders an em-dash when both sides are missing (no envelope companion)", () => {
    const span = document.createElement("span");
    formatMinMaxContent(span, baseRow, TEXT_COLOR, "min");
    expect(span.textContent).toBe("—");
    formatMinMaxContent(span, baseRow, TEXT_COLOR, "max");
    expect(span.textContent).toBe("—");
  });

  it("clears stale numeric content when the next render is em-dash", () => {
    // Mirror the cleanup test in formatRawValueContent — guard against the
    // fast-path updating a previously-numeric span to em-dash.
    const span = document.createElement("span");
    formatMinMaxContent(span, { ...baseRow, minValue: 0.5 }, TEXT_COLOR, "min");
    formatMinMaxContent(span, baseRow, TEXT_COLOR, "min");
    expect(span.textContent).toBe("—");
    expect(span.style.opacity).toBe("0.4");
  });

  // rowHidden cases — when the user toggled a series off in the legend, the
  // entire row is rendered with a "hidden" warning and warning styling.
  it("renders 'hidden' warning when rowHidden is true (which='min')", () => {
    const span = document.createElement("span");
    formatMinMaxContent(
      span,
      { ...baseRow, rowHidden: true, minValue: 0.5, maxValue: 9.9 },
      TEXT_COLOR,
      "min",
    );
    expect(span.textContent).toBe("hidden");
    expect(span.style.color).toBe("rgb(232, 168, 56)"); // #e8a838 warning yellow
    expect(span.style.fontWeight).toBe("600");
    expect(span.style.fontStyle).toBe("italic");
  });

  it("renders 'hidden' warning when rowHidden is true (which='max')", () => {
    const span = document.createElement("span");
    formatMinMaxContent(
      span,
      { ...baseRow, rowHidden: true, minValue: 0.5, maxValue: 9.9 },
      TEXT_COLOR,
      "max",
    );
    expect(span.textContent).toBe("hidden");
    expect(span.style.color).toBe("rgb(232, 168, 56)");
  });
});

// ── formatValueContent ──────────────────────────────────────────────────────
// Renders the primary Value tooltip cell. The interpolation branch (when the
// cursor falls between two real points of a sparser series) prefixes the
// value with `~` and dims+italicises it. Flag text (NaN/Inf) overrides
// everything because it carries the more important information.

describe("formatValueContent", () => {
  it("renders a plain number when isInterpolated is false", () => {
    const span = document.createElement("span");
    formatValueContent(span, { ...baseRow, value: 0.7 }, TEXT_COLOR);
    expect(span.textContent).toBe(formatAxisLabel(0.7));
    expect(span.style.fontStyle).toBe("");
    expect(span.style.opacity).toBe("");
  });

  it("prefixes ~ and applies italic+0.6 opacity when isInterpolated is true", () => {
    // Catches the interpolation feature regressing — without the ~prefix the
    // user can't distinguish real measured values from synthesized ones.
    const span = document.createElement("span");
    formatValueContent(
      span,
      { ...baseRow, value: 0.7, isInterpolated: true },
      TEXT_COLOR,
    );
    expect(span.textContent).toBe(`~${formatAxisLabel(0.7)}`);
    expect(span.style.fontStyle).toBe("italic");
    expect(span.style.opacity).toBe("0.6");
  });

  it("prefers flagText over interpolated rendering when both are set", () => {
    // A NaN/Inf bucket in a sparser series can technically also be marked
    // interpolated; flag text should win because non-finite values are the
    // critical thing to surface.
    const span = document.createElement("span");
    formatValueContent(
      span,
      { ...baseRow, value: 0.7, isInterpolated: true, flagText: "NaN" },
      TEXT_COLOR,
    );
    expect(span.textContent).toBe("NaN");
    expect(span.style.color).toBe("rgb(232, 168, 56)"); // warning yellow
    expect(span.style.fontWeight).toBe("600");
  });

  it("clears interpolation styles when re-rendering a non-interpolated value on the same span", () => {
    // Fast-path mutates the same span across hover events. Italic/opacity
    // from a previous interpolated render must not leak into a later real
    // render.
    const span = document.createElement("span");
    formatValueContent(
      span,
      { ...baseRow, value: 0.7, isInterpolated: true },
      TEXT_COLOR,
    );
    formatValueContent(span, { ...baseRow, value: 0.8 }, TEXT_COLOR);
    expect(span.textContent).toBe(formatAxisLabel(0.8));
    expect(span.style.fontStyle).toBe("");
    expect(span.style.opacity).toBe("");
  });
});

// ── createPinHintRow ─────────────────────────────────────────────────────────
// Small header hint telling the user a left-click pins the tooltip for resizing.

describe("createPinHintRow", () => {
  it("renders the pin-hint copy and is tagged for lookup", () => {
    const row = createPinHintRow();
    expect(row.textContent).toBe(PIN_HINT_TEXT);
    expect(row.getAttribute("data-tooltip-pin-hint")).toBe("true");
  });

  it("mentions left-click, pinning, and resizing so the affordance is clear", () => {
    expect(PIN_HINT_TEXT.toLowerCase()).toContain("left-click");
    expect(PIN_HINT_TEXT.toLowerCase()).toContain("pin");
    expect(PIN_HINT_TEXT.toLowerCase()).toContain("resize");
  });

  it("reads as muted via opacity and inherits color (no hardcoded color)", () => {
    const row = createPinHintRow();
    expect(row.style.opacity).toBe("0.5");
    expect(row.style.color).toBe("");
  });
});
