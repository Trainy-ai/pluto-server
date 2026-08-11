import { filterRunsByLog } from "@/lib/filter-runs-by-log";

export interface OverlaySelection<T> {
  /** The runs to draw, narrowed then capped. */
  runs: T[];
  /**
   * How many runs hold this chart's table, before the cap. What the
   * "showing N of M" caption must count — the selection size is a different
   * number and comparing against it reads as truncation that isn't happening.
   */
  totalWithData: number;
}

/**
 * Pick the runs an overlaid custom chart should draw.
 *
 * Order matters and is the bug this exists to prevent. Capping first takes the
 * first N of the SELECTION and asks those for the table; on `migrate-final`,
 * 13 runs held `roc_table` and exactly one of them sat inside the first 25 of a
 * 481-run selection, so a chart wandb drew with ten lines drew with one. The
 * legend wasn't broken — there was genuinely one series. Narrowing first means
 * the cap only ever trims runs that actually have data.
 *
 * Fails open while the mapping is unresolved, matching filterRunsByLog: better
 * to draw the pre-narrowing set for one paint than to blank the chart.
 */
export function selectOverlayRuns<T extends { runId: string }>(
  runs: T[],
  runIdsForTable: readonly string[] | undefined,
  cap: number,
): OverlaySelection<T> {
  const withData = filterRunsByLog(runs, runIdsForTable);
  return { runs: withData.slice(0, cap), totalWithData: withData.length };
}
