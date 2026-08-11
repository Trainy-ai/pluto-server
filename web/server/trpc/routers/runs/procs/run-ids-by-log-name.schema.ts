import { z } from "zod";

/**
 * Upper bound on the selection this lookup will resolve. Bounded by query and
 * URL size, not per-run work — run_logs is indexed on runId.
 *
 * Deliberately far above the data procs' MAX_RUNS_PER_BATCH (200): the point of
 * this lookup is to narrow a selection those procs would reject, so capping it
 * at 200 too would make it useless.
 */
export const MAX_RUNS_FOR_LOOKUP = 5000;

/**
 * Upper bound on names per lookup. Callers must slice to this rather than
 * relying on the rejection: one over-long list fails the WHOLE request, so
 * every entry in it loses its narrowing, not just the overflow.
 */
export const MAX_LOG_NAMES_FOR_LOOKUP = 200;

export const runIdsByLogNameInput = z.object({
  projectName: z.string(),
  logNames: z.array(z.string()).min(1).max(MAX_LOG_NAMES_FOR_LOOKUP),
  runIds: z.array(z.string()).min(1).max(MAX_RUNS_FOR_LOOKUP),
});
