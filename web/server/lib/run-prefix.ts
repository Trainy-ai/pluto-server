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
