/**
 * Formats a run label for display in charts, tooltips, and exports.
 * When a displayId is available (e.g., "MMP-42"), it's appended to the
 * run name to differentiate runs that share the same name.
 */
export function formatRunLabel(runName: string, displayId?: string | null): string {
  if (displayId) {
    return `${runName} (${displayId})`;
  }
  return runName;
}
