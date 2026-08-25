// Python Panels — requirements input parsing/validation.
//
// The panel editor takes micropip package names as free text (comma or
// newline separated). These helpers normalize that text into the
// `requirements: string[]` shape of PanelWidgetConfig and mirror the
// server-side Zod limits (web/server/lib/dashboard-types.ts:
// PanelWidgetConfigSchema — max 20 entries, each 1..100 chars) so
// invalid input is caught before the save mutation.

/** Server-enforced cap on the number of requirement entries. */
export const MAX_REQUIREMENTS = 20;
/** Server-enforced cap on a single requirement's length. */
export const MAX_REQUIREMENT_LENGTH = 100;

// Package name w/ optional extras + version specifier, e.g.
// "seaborn", "plotly==5.22.0", "pandas>=2,<3", "foo[bar]~=1.0".
// Deliberately loose — micropip is the real authority — but tight
// enough to reject obvious garbage (spaces, shell metacharacters).
const REQUIREMENT_PATTERN =
  /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?(?:\[[A-Za-z0-9._,-]+\])?(?:[=!<>~^][=<>]?[A-Za-z0-9.*+,<>=!~-]*)?$/;

/**
 * Split free-form requirements text into normalized entries: comma or
 * newline separated, trimmed, empties dropped, first-seen order kept,
 * case-insensitive duplicates removed.
 */
export function parseRequirements(text: string): string[] {
  const seen = new Set<string>();
  const requirements: string[] = [];
  for (const raw of text.split(/[\n,]/)) {
    const entry = raw.trim();
    if (entry.length === 0) {
      continue;
    }
    const key = entry.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    requirements.push(entry);
  }
  return requirements;
}

/**
 * Validate parsed requirements against the server schema limits.
 * Returns a human-readable error, or null when valid.
 */
export function validateRequirements(requirements: string[]): string | null {
  if (requirements.length > MAX_REQUIREMENTS) {
    return `Too many packages (${requirements.length}) — the limit is ${MAX_REQUIREMENTS}.`;
  }
  for (const requirement of requirements) {
    if (requirement.length > MAX_REQUIREMENT_LENGTH) {
      return `"${requirement.slice(0, 40)}…" is too long — package specs are capped at ${MAX_REQUIREMENT_LENGTH} characters.`;
    }
    if (!REQUIREMENT_PATTERN.test(requirement)) {
      return `"${requirement}" is not a valid package spec (use pip-style names like "seaborn" or "plotly==5.22.0").`;
    }
  }
  return null;
}

/** Inverse of parseRequirements for populating the editor input. */
export function formatRequirements(requirements: string[]): string {
  return requirements.join(", ");
}

/** Order-sensitive equality of two requirement lists. */
export function requirementsEqual(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((entry, index) => entry === b[index]);
}
