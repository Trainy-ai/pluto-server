import { useMemo } from "react";
import { useChartColors } from "@/components/ui/color-picker";

/**
 * A stable colour per sweep run, keyed by run id.
 *
 * The sweep page has no runs-table selection to inherit colours from, so it
 * assigns its own off the user's chart palette. Assignment is by the run order
 * the sweep proc returns (stable for a finished sweep), which is what lets the
 * runs table and the metric curves agree: the swatch beside a run is the colour
 * of its line.
 *
 * Deliberately NOT applied to the progress scatter or the parallel-coords
 * lines: those encode the objective's VALUE in colour ("bright is better"), a
 * different meaning that per-run colours would destroy.
 */
export function useSweepRunColors(runs: { runId: string }[]): Map<string, string> {
  const palette = useChartColors();
  return useMemo(() => {
    const map = new Map<string, string>();
    runs.forEach((run, i) => {
      map.set(run.runId, palette[i % palette.length]);
    });
    return map;
  }, [runs, palette]);
}
