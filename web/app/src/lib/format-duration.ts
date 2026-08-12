/**
 * Format a duration in milliseconds as a compact, human-readable string.
 *
 *   5_400_000 → "1h 30m 0s"
 *      90_000 → "1m 30s"
 *       5_000 → "5s"
 *           0 → "0s"
 *
 * Shared by the dashboard "Recent Runs" widget (via useDuration) and the
 * experiments table's Duration column so the two render identically.
 *
 * Mirrors the historical behaviour: hours/minutes are only shown when
 * non-zero, seconds are always shown. Non-finite or negative inputs (clock
 * skew, missing timestamps) collapse to "0s".
 */
/**
 * When a finished run actually ended.
 *
 * `updatedAt` is Prisma's `@updatedAt`: it bumps on ANY write to the run row —
 * a tag edit, a config merge, a field-value backfill — so it is not a finish
 * time and must never be used as one. `statusUpdated` is the moment the run
 * reached its terminal status (#528), which is the real end.
 *
 * A run imported by `pluto migrate` shows why this matters: it is created with
 * a historical `createdAt`, finished ~2s later, then touched again days
 * afterwards by unrelated metadata writes. Measuring to `updatedAt` reports
 * that 2s run as ~101 hours.
 *
 * Falls back to `updatedAt` for runs predating `statusUpdated`. Returns the
 * source `Date` unchanged when there is one, so callers can pass the result
 * straight into a hook dependency without re-triggering on every render.
 *
 * Only meaningful for terminal runs — a RUNNING run's end is now (see
 * `useDuration`) or its ClickHouse heartbeat (see the table's Duration column).
 */
export function terminalEndTime(run: {
  statusUpdated?: Date | string | null;
  updatedAt: Date | string;
}): Date {
  const end = run.statusUpdated ?? run.updatedAt;
  return end instanceof Date ? end : new Date(end);
}

export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "0s";

  const hours = Math.floor(ms / (1000 * 60 * 60));
  const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
  const seconds = Math.floor((ms % (1000 * 60)) / 1000);

  const parts: string[] = [];
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  parts.push(`${seconds}s`);

  return parts.join(" ");
}
