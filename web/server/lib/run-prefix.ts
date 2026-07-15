/**
 * Generates a short prefix from a project name for Neptune-style run display IDs.
 *
 * Examples:
 *   "my-ml-project"       → "MMP"
 *   "training"            → "TRA"
 *   "image-classification" → "ICL"
 *   "resnet-50"           → "R50"
 *   "a"                   → "A"
 *   "my project name"     → "MPN"
 */
export function generateRunPrefix(projectName: string): string {
  // Split by common separators (hyphens, underscores, spaces, dots)
  const words = projectName
    .split(/[-_\s.]+/)
    .filter((w) => w.length > 0);

  if (words.length === 0) {
    return "RUN";
  }

  let prefix: string;

  if (words.length === 1) {
    // Single word: take first 3 characters
    prefix = words[0].slice(0, 3);
  } else {
    // Multiple words: take first character of each word
    prefix = words.map((w) => w[0]).join("");

    // If less than 3 chars, pad with more characters from the last word
    if (prefix.length < 3) {
      const lastWord = words[words.length - 1];
      const needed = 3 - prefix.length;
      prefix = prefix.slice(0, -1) + lastWord.slice(0, needed + 1);
    }

    // Cap at 4 characters
    prefix = prefix.slice(0, 4);
  }

  return prefix.toUpperCase();
}

/**
 * Parses a Neptune-style display ID (e.g. "MMP-1") into its prefix and number.
 *
 * Returns null when the string is not in PREFIX-NUMBER format. The prefix is
 * upper-cased to match the stored `Projects.runPrefix`.
 *
 * NOTE: a display ID is NOT globally unique. The prefix is derived from the
 * project name via `generateRunPrefix`, so distinct project names can collapse
 * to the same prefix (e.g. "monitor_tests" and "monitor-tests" both → "MTE").
 * Combined with per-project run numbering, a display ID like "MTE-1" can match
 * runs in several projects. Callers must scope by project (or handle ambiguity)
 * when resolving a display ID to a single run.
 */
export function parseDisplayId(displayId: string): { prefix: string; number: number } | null {
  const match = displayId.match(/^([A-Za-z0-9]+)-(\d+)$/);
  if (!match) {
    return null;
  }
  return { prefix: match[1].toUpperCase(), number: parseInt(match[2], 10) };
}
