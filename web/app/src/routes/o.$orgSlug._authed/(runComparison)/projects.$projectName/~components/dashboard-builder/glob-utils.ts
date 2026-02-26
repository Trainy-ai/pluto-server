/**
 * Glob & Regex utilities for dashboard chart widget metric selection.
 *
 * PROBLEM:
 * A chart widget needs to know which metrics to plot. The user can either
 * pick specific metrics ("train/loss") or use patterns to match many at once
 * ("all metrics starting with train/"). We need to store both in the same
 * config.metrics array and tell them apart when rendering.
 *
 * SOLUTION — Prefixed strings:
 * We use string prefixes to encode the type of each entry:
 *
 *   config.metrics: [
 *     "train/loss",                  // literal — plot exactly this metric
 *     "glob:train/*",                // glob — plot anything matching train/*
 *     "regex:(train|test)/.+",       // regex — plot anything matching this regex
 *   ]
 *
 * WHY PREFIXES?
 * Without them, "train/*" is ambiguous — is it a literal metric name or a
 * glob pattern? The "glob:" and "regex:" prefixes make it unambiguous.
 *
 * HOW PATTERNS GET RESOLVED:
 * Patterns are "dynamic" — they're stored as-is in the database and resolved
 * to actual metric names every time the chart renders (in widget-renderer.tsx).
 *
 * Example: A widget is saved with config.metrics: ["glob:train/*"]
 *   - Day 1: selected runs have train/loss, train/accuracy → chart shows 2 lines
 *   - Day 2: user adds a new run with train/perplexity → chart shows 3 lines
 *   - The widget config didn't change, but the resolved metrics did.
 *
 * THIS FILE PROVIDES:
 *   - Prefix helpers: create, detect, and extract glob/regex values
 *   - globToRegex(): convert "train/*" → /^train\/.*$/i for client-side matching
 *   - resolveMetrics(): take a config.metrics array and expand all patterns
 *     against a list of available metric names, returning a flat list of
 *     actual metric names to plot
 *
 * USED BY:
 *   - add-widget-modal.tsx — UI for selecting metrics and applying patterns
 *   - metric-selector.tsx — displaying pattern badges in the dropdown
 *   - widget-renderer.tsx — resolving patterns to actual metrics at render time
 */

import { matchMetricsByPattern } from "./pattern-matching-utils";

/** Prefix for glob patterns — e.g. "glob:train/*" */
export const GLOB_PREFIX = "glob:";

/** Prefix for regex patterns — e.g. "regex:(train|test)/.+" */
export const REGEX_PREFIX = "regex:";

/** Check if a metrics entry is a glob pattern. e.g. isGlobValue("glob:train/*") → true */
export function isGlobValue(value: string): boolean {
  return value.startsWith(GLOB_PREFIX);
}

/** Extract the glob pattern from a prefixed value. e.g. getGlobPattern("glob:train/*") → "train/*" */
export function getGlobPattern(value: string): string {
  return value.slice(GLOB_PREFIX.length);
}

/** Create a prefixed glob value for storage. e.g. makeGlobValue("train/*") → "glob:train/*" */
export function makeGlobValue(pattern: string): string {
  return GLOB_PREFIX + pattern;
}

/** Check if a metrics entry is a regex pattern. e.g. isRegexValue("regex:.+/loss") → true */
export function isRegexValue(value: string): boolean {
  return value.startsWith(REGEX_PREFIX);
}

/** Extract the regex pattern from a prefixed value. e.g. getRegexPattern("regex:.+/loss") → ".+/loss" */
export function getRegexPattern(value: string): string {
  return value.slice(REGEX_PREFIX.length);
}

/** Create a prefixed regex value for storage. e.g. makeRegexValue(".+/loss") → "regex:.+/loss" */
export function makeRegexValue(pattern: string): string {
  return REGEX_PREFIX + pattern;
}

/** Returns true if the value is any kind of pattern (glob or regex), false for literal metric names */
export function isPatternValue(value: string): boolean {
  return isGlobValue(value) || isRegexValue(value);
}

/**
 * Auto-detect whether a raw pattern (no prefix) looks like glob or regex,
 * and wrap it with the appropriate prefix.
 *
 * Heuristic: if it contains `*` or `?` but none of the regex-specific
 * characters like `(`, `)`, `|`, `+`, `{`, `}`, `^`, `$`, treat as glob.
 * Otherwise treat as regex.
 */
export function autoDetectPattern(pattern: string): string {
  if (isGlobValue(pattern) || isRegexValue(pattern)) {
    return pattern;
  }
  const hasGlobChars = /[*?]/.test(pattern);
  const hasRegexChars = /[()|\+{}^$]/.test(pattern);
  if (hasGlobChars && !hasRegexChars) {
    return makeGlobValue(pattern);
  }
  return makeRegexValue(pattern);
}

/**
 * Convert a glob pattern to a RegExp for client-side matching.
 *   - `*` becomes `.*` (match anything)
 *   - `?` becomes `.`  (match single char)
 *   - All other regex special chars are escaped
 *   - Case-insensitive
 */
// Examples:
//   globToRegex("train/*")  matches "train/loss", "train/accuracy"
//   globToRegex("*/loss")   matches "train/loss", "test/loss"
export function globToRegex(pattern: string): RegExp {
  // Collapse consecutive wildcards to prevent ReDoS (e.g. "***" → "*" → ".*" not ".*.*.*")
  const collapsed = pattern.replace(/\*+/g, "*");
  const escaped = collapsed.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  const regexStr = "^" + escaped.replace(/\*/g, ".*").replace(/\?/g, ".") + "$";
  return new RegExp(regexStr, "i");
}

/**
 * Resolve a metrics array (which may contain "glob:..." and "regex:..." entries)
 * into a flat list of actual metric names by matching patterns against available metrics.
 *
 * Example:
 *   metricsWithPatterns: ["train/loss", "glob:test/*", "regex:.+/accuracy"]
 *   availableMetrics:    ["train/loss", "test/loss", "test/accuracy", "val/accuracy"]
 *   → returns:           ["test/accuracy", "test/loss", "train/loss", "val/accuracy"]
 *
 * Literal names are included as-is. Patterns are expanded against availableMetrics.
 * Results are deduped and sorted alphabetically.
 */
export function resolveMetrics(
  metricsWithPatterns: string[],
  availableMetrics: string[]
): string[] {
  const result = new Set<string>();

  for (const entry of metricsWithPatterns) {
    if (isGlobValue(entry)) {
      // Glob: convert to regex and test each available metric client-side
      const pattern = getGlobPattern(entry);
      try {
        const regex = globToRegex(pattern);
        for (const metric of availableMetrics) {
          if (regex.test(metric)) {
            result.add(metric);
          }
        }
      } catch {
        // Invalid pattern — skip silently so one bad pattern doesn't break the dashboard
      }
    } else if (isRegexValue(entry)) {
      // Regex: match against available metrics client-side
      // (the server already filtered via ClickHouse match(), so this is a redundant
      // safety filter — but it's cheap and guards against unexpected server results)
      const pattern = getRegexPattern(entry);
      try {
        const matches = matchMetricsByPattern(pattern, availableMetrics);
        for (const match of matches) {
          result.add(match);
        }
      } catch {
        // Invalid regex pattern — skip silently
      }
    } else {
      // Literal metric name — include directly
      result.add(entry);
    }
  }

  return Array.from(result).sort((a, b) => a.localeCompare(b));
}
