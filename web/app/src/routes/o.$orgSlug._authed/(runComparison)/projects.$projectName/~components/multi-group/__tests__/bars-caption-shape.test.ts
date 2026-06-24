import { describe, it, expect } from "vitest";
import { buildBarsCaptionShape } from "../bars-caption-shape";

const RUN_A = { name: "run-A", color: "#aaa" };
const RUN_B = { name: "run-B", color: "#bbb" };
const RUN_C = { name: "run-C", color: "#ccc" };

describe("buildBarsCaptionShape", () => {
  // mode=step → one (run, step) pair regardless of depthAxis.
  it("step mode: surfaces step text + currentRun chip (depthAxis=step)", () => {
    expect(
      buildBarsCaptionShape({
        mode: "step",
        depthAxis: "step",
        currentStepValue: 42,
        currentRun: RUN_A,
        perRun: [RUN_A, RUN_B, RUN_C],
      }),
    ).toEqual({ step: "step 42", runs: [RUN_A] });
  });

  it("step mode: surfaces step text + currentRun chip (depthAxis=run)", () => {
    // Depth axis is ignored in step mode (the toggle is disabled).
    expect(
      buildBarsCaptionShape({
        mode: "step",
        depthAxis: "run",
        currentStepValue: 7,
        currentRun: RUN_B,
        perRun: [RUN_A, RUN_B],
      }),
    ).toEqual({ step: "step 7", runs: [RUN_B] });
  });

  // mode=ridgeline, depthAxis=step → ONE run across many steps.
  // Step text is meaningless (all steps shown); only the run chip helps.
  it("ridgeline depth=step: omits step, keeps single currentRun chip", () => {
    expect(
      buildBarsCaptionShape({
        mode: "ridgeline",
        depthAxis: "step",
        currentStepValue: 100,
        currentRun: RUN_A,
        perRun: [RUN_A, RUN_B, RUN_C],
      }),
    ).toEqual({ step: undefined, runs: [RUN_A] });
  });

  // mode=ridgeline, depthAxis=run → ONE step across many runs.
  // Step text matters (slider picks it); all runs are rendered as rows.
  it("ridgeline depth=run: surfaces step text + every run chip", () => {
    expect(
      buildBarsCaptionShape({
        mode: "ridgeline",
        depthAxis: "run",
        currentStepValue: 200,
        currentRun: RUN_A,
        perRun: [RUN_A, RUN_B, RUN_C],
      }),
    ).toEqual({
      step: "step 200",
      runs: [RUN_A, RUN_B, RUN_C],
    });
  });

  // Heatmap mirrors ridgeline — same matrix.
  it("heatmap depth=step: omits step, keeps single currentRun chip", () => {
    expect(
      buildBarsCaptionShape({
        mode: "heatmap",
        depthAxis: "step",
        currentStepValue: 9,
        currentRun: RUN_C,
        perRun: [RUN_A, RUN_B, RUN_C],
      }),
    ).toEqual({ step: undefined, runs: [RUN_C] });
  });

  it("heatmap depth=run: surfaces step text + every run chip", () => {
    expect(
      buildBarsCaptionShape({
        mode: "heatmap",
        depthAxis: "run",
        currentStepValue: 1,
        currentRun: RUN_A,
        perRun: [RUN_A, RUN_B],
      }),
    ).toEqual({ step: "step 1", runs: [RUN_A, RUN_B] });
  });

  // Edge cases.
  it("returns an empty runs array when currentRun is null in step mode", () => {
    // Happens momentarily during a run-slider scrub to an out-of-range
    // index; widget guards against rendering, but the helper shouldn't
    // throw or fabricate a chip.
    expect(
      buildBarsCaptionShape({
        mode: "step",
        depthAxis: "step",
        currentStepValue: 5,
        currentRun: null,
        perRun: [RUN_A],
      }),
    ).toEqual({ step: "step 5", runs: [] });
  });

  it("strips extra fields off run objects and returns a clean chip list", () => {
    expect(
      buildBarsCaptionShape({
        mode: "ridgeline",
        depthAxis: "run",
        currentStepValue: 3,
        currentRun: RUN_A,
        // Simulate a richer PerRunData shape that has extra fields. Only
        // {name, color} should make it into the caption.
        perRun: [
          { ...RUN_A, runId: "abc", extra: 1 } as { name: string; color: string },
          { ...RUN_B, runId: "def", extra: 2 } as { name: string; color: string },
        ],
      }).runs,
    ).toEqual([RUN_A, RUN_B]);
  });
});
