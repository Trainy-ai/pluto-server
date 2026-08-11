import { z } from "zod";

/**
 * Upper bound on the selection this discovery will scan. Deliberately far above
 * the data procs' 200-run cap: this is one Postgres pass over `runs.config`
 * (~5ms across a 771-run project), and capping it low would reintroduce the
 * sampling this proc exists to remove.
 */
export const MAX_RUNS_FOR_PANEL_SCAN = 5000;

export const customChartPanelsInput = z.object({
  projectName: z.string(),
  runIds: z.array(z.string()).min(1).max(MAX_RUNS_FOR_PANEL_SCAN),
});
