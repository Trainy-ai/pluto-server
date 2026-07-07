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
