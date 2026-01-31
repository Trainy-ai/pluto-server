import type { GroupedMetrics } from "@/lib/grouping/types";

/**
 * Extract all metric names from GroupedMetrics.
 * Only includes METRIC type by default (for chart widgets).
 *
 * Note: metric.name already contains the full path (e.g., "training/dataset/favorita_sales").
 * The groupName is just for UI grouping, not part of the metric identifier.
 */
export function extractMetricNames(
  groupedMetrics: GroupedMetrics,
  includeTypes: string[] = ["METRIC"]
): string[] {
  const names: string[] = [];

  for (const [, group] of Object.entries(groupedMetrics)) {
    for (const metric of group.metrics) {
      if (includeTypes.includes(metric.type)) {
        names.push(metric.name);
      }
    }
  }

  return names.sort();
}

/**
 * Patterns that can cause catastrophic backtracking (ReDoS).
 * We reject these upfront rather than trying to timeout (which doesn't work
 * since regex.test() is synchronous and blocks the main thread).
 */
const DANGEROUS_PATTERN_REGEX =
  /(\.\*){3,}|(\.\+){3,}|(\+\+)|(\{\d+,\}){2,}|(\([^)]*\+[^)]*\))\1|\(\?[^)]+\)\+/;

/**
 * Check if a regex pattern is safe to execute.
 * Rejects patterns that could cause catastrophic backtracking.
 */
function isPatternSafe(pattern: string): boolean {
  // Reject overly long patterns
  if (pattern.length > 100) {
    return false;
  }

  // Reject patterns with dangerous constructs
  if (DANGEROUS_PATTERN_REGEX.test(pattern)) {
    return false;
  }

  return true;
}

/**
 * Match metric names against a regex pattern.
 * Returns an array of matching metric names.
 *
 * Validates patterns upfront to prevent ReDoS attacks.
 */
export function matchMetricsByPattern(
  pattern: string,
  metricNames: string[]
): string[] {
  const trimmedPattern = pattern.trim();
  if (!trimmedPattern) {
    return [];
  }

  // Reject potentially dangerous patterns upfront
  if (!isPatternSafe(trimmedPattern)) {
    return [];
  }

  try {
    const regex = new RegExp(trimmedPattern);
    return metricNames.filter((name) => regex.test(name));
  } catch {
    return [];
  }
}
