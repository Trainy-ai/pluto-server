import { describe, it, expect } from "vitest";
import { mapXAxisToDisplayLogName } from "../x-axis-utils";

describe("mapXAxisToDisplayLogName", () => {
  // Built-in values
  it('maps "step" to "Step"', () => {
    expect(mapXAxisToDisplayLogName("step")).toBe("Step");
  });

  it('maps "time" (legacy) to "Absolute Time"', () => {
    expect(mapXAxisToDisplayLogName("time")).toBe("Absolute Time");
  });

  it('maps "absolute-time" to "Absolute Time"', () => {
    expect(mapXAxisToDisplayLogName("absolute-time")).toBe("Absolute Time");
  });

  it('maps "relative-time" to "Relative Time"', () => {
    expect(mapXAxisToDisplayLogName("relative-time")).toBe("Relative Time");
  });

  // Custom metric names (parametric curve)
  it("passes through a simple metric name", () => {
    expect(mapXAxisToDisplayLogName("learning_rate")).toBe("learning_rate");
  });

  it("passes through a slashed metric path", () => {
    expect(mapXAxisToDisplayLogName("training/epoch_loss")).toBe(
      "training/epoch_loss",
    );
  });

  it("passes through a deeply nested metric", () => {
    expect(
      mapXAxisToDisplayLogName("optimizer/group_0/lr"),
    ).toBe("optimizer/group_0/lr");
  });

  // Edge cases
  it('does not confuse "Step" (capitalized) with "step"', () => {
    // "Step" is not a built-in config value — only "step" is
    expect(mapXAxisToDisplayLogName("Step")).toBe("Step");
  });

  it("handles empty string as custom metric", () => {
    expect(mapXAxisToDisplayLogName("")).toBe("");
  });
});
