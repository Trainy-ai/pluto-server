import type { CategoricalStep } from "@/routes/o.$orgSlug._authed/(run)/projects.$projectName.$runId/~components/group/categorical-canvas";

export interface BinRange {
  start: number; // 1-indexed inclusive
  end: number; // 1-indexed inclusive
}

export interface PerRunData {
  runId: string;
  runName: string;
  color: string;
  steps: CategoricalStep[];
}

// Slice the canonical-ordered bin list to the [start, end] window
// (1-indexed inclusive both ends). The proc returns labels in
// canonical order (max-value across the run, desc), so {1, 30} keeps
// the top-30 and {90, 120} windows into the tail. If the resulting
// window is the full bin set, return the input unchanged (avoids a
// useless map allocation when the user hasn't narrowed).
export function applyBinRange(
  perRun: PerRunData[],
  start: number,
  end: number,
): PerRunData[] {
  let totalLabels = 0;
  for (const run of perRun) {
    const first = run.steps[0];
    if (first) {
      totalLabels = first.bars.labels.length;
      break;
    }
  }
  if (totalLabels === 0) return perRun;
  const s = Math.max(1, Math.min(totalLabels, Math.floor(start)));
  const e = Math.max(s, Math.min(totalLabels, Math.floor(end)));
  if (s === 1 && e === totalLabels) return perRun;
  const i0 = s - 1;
  const i1 = e; // slice exclusive on end → e directly
  return perRun.map((run) => ({
    ...run,
    steps: run.steps.map((step) => {
      const old = step.bars;
      const newFreq = old.freq.slice(i0, i1);
      const newLabels = old.labels.slice(i0, i1);
      return {
        step: step.step,
        bars: {
          freq: newFreq,
          labels: newLabels,
          maxFreq: Math.max(0, ...newFreq),
          shape: "categorical" as const,
          type: "Histogram" as const,
        },
      };
    }),
  }));
}
