/**
 * Restrict a widget's runs to the ones that actually logged `logName`.
 *
 * Dashboard widgets are config-driven and start out knowing only a log name,
 * so without this they hand their whole selection to the batch data procs and
 * throw away the empty responses. `runs.runIdsByLogName` supplies the mapping.
 *
 * Fail-open while the mapping is unresolved (`undefined`): keep every run, so
 * a widget renders exactly as it did before rather than flashing an empty
 * state on first paint or when the lookup errors. An empty array is a resolved
 * answer — no run has this log — and filters everything out.
 */
export function filterRunsByLog<T extends { runId: string }>(
  runs: T[],
  runIdsForLog: readonly string[] | undefined,
): T[] {
  if (!runIdsForLog) return runs;
  const allowed = new Set(runIdsForLog);
  return runs.filter((run) => allowed.has(run.runId));
}
