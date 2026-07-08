/**
 * Extract a clean, user-facing reason from a mutation/query error, or null when
 * there's no human-readable message to show.
 *
 * A manually-thrown `TRPCError({ message })` arrives on the client as
 * `err.message` verbatim (e.g. "A run can have at most one group:* tag."),
 * which is exactly what we want to surface. Zod validation failures, however,
 * come through as a JSON-encoded issue list — not human-friendly — so we return
 * null for those and let the caller fall back to its own generic message.
 */
export function errorReason(err: unknown): string | null {
  const raw = err instanceof Error ? err.message.trim() : "";
  if (!raw || raw.startsWith("[") || raw.startsWith("{")) return null;
  return raw;
}
