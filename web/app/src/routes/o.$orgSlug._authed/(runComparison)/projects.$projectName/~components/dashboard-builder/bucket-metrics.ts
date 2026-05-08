/**
 * Pure helpers for the dynamic-section grouping feature. Kept in a separate
 * file (no React or tRPC imports) so they can be unit-tested without pulling
 * in the env-validated tRPC client.
 */

/** Split a metric path into [prefix, suffix] using the last `/` as separator. */
export function splitMetricPath(metric: string): { prefix: string; suffix: string } {
  const slashIdx = metric.lastIndexOf("/");
  if (slashIdx === -1) return { prefix: "", suffix: metric };
  return { prefix: metric.slice(0, slashIdx), suffix: metric.slice(slashIdx + 1) };
}

/** Internal separator for tuple-bucket keys — unlikely to appear in metric names. */
const TUPLE_SEP = "";

/** Display separator for capture-tuple titles, e.g. "5T · CRPS". */
const DISPLAY_SEP = " · ";

/** Bucket info attached to a group — what it represents and how to label it. */
export interface BucketGroup {
  /** Stable key for the bucket (used as Map key + widget id derivation). */
  key: string;
  /** Human-readable title for the widget. */
  title: string;
  /** Member metric paths in this bucket. */
  members: string[];
}

/**
 * Apply prefix + suffix grouping rules to a list of metric paths.
 *
 * Both filters are LOOSE (additive): a metric only contributes to a combined
 * widget when its prefix AND suffix both qualify. Otherwise it falls through
 * as a standalone widget. Nothing is hidden.
 *
 * - `groupBySuffixes`: trailing path segments that combine. If empty, no
 *   combining at all — every metric is standalone.
 * - `prefixAllowlist`: which literal prefixes are eligible to combine. If
 *   empty, all prefixes are eligible. If set, only metrics with a matching
 *   prefix combine. Mutually exclusive with `prefixRegex` — regex wins.
 * - `prefixRegex`: optional regex applied to each metric path. When set,
 *   replaces the prefix-allowlist mode entirely:
 *     * Metrics matching the regex bucket by their capture-group tuple.
 *     * Multiple capture groups → bucket key = JOIN(captures, TUPLE_SEP).
 *     * Zero capture groups → all matches go to one bucket keyed `"*"`.
 *     * Metrics not matching the regex pass through as standalone widgets.
 *   An invalid regex pattern is ignored (treated as no regex set), so a
 *   half-typed regex in the dialog never accidentally hides metrics.
 *
 * Returns:
 *   - `groups`: Map<bucketKey, BucketGroup> — each becomes one combined widget
 *   - `passthrough`: metrics rendered as their own single-metric widget
 *
 * Singleton groups (1 member) fall back to `passthrough` to avoid creating
 * a "combined" widget with only one series.
 */
export function bucketMetricsByPrefix(
  metrics: string[],
  groupBySuffixes: string[],
  prefixAllowlist: string[] = [],
  prefixRegex?: string,
): { groups: Map<string, BucketGroup>; passthrough: string[] } {
  const groups = new Map<string, BucketGroup>();
  const passthrough: string[] = [];

  const suffixSet = new Set(groupBySuffixes.map((s) => s.trim()).filter((s) => s.length > 0));
  const hasSuffixFilter = suffixSet.size > 0;

  if (!hasSuffixFilter) {
    // No combining requested at all — every metric stands alone. Prefix
    // allowlist / regex are meaningless without suffix combining.
    return { groups, passthrough: metrics };
  }

  // Try to compile regex if provided. Invalid regex degrades to "no regex
  // active" so a half-typed pattern in the dialog can't accidentally hide
  // metrics — they still render as their own widgets via the literal path.
  let compiledRegex: RegExp | null = null;
  const trimmedRegex = prefixRegex?.trim() ?? "";
  if (trimmedRegex.length > 0) {
    try {
      compiledRegex = new RegExp(trimmedRegex);
    } catch {
      compiledRegex = null;
    }
  }

  if (compiledRegex) {
    // Regex mode: bucket by capture-group tuple
    for (const metric of metrics) {
      const { suffix } = splitMetricPath(metric);
      if (!suffixSet.has(suffix)) {
        passthrough.push(metric);
        continue;
      }
      const m = metric.match(compiledRegex);
      if (!m) {
        // Doesn't match the regex — render alone
        passthrough.push(metric);
        continue;
      }
      // Captures = m.slice(1). When there are no captures, group everything
      // matching into a single bucket keyed "*".
      const captures = m.slice(1);
      const tuple = captures.length === 0 ? ["*"] : captures.map((c) => c ?? "");
      const key = tuple.join(TUPLE_SEP);
      const title = captures.length === 0 ? "matches" : tuple.join(DISPLAY_SEP);
      const existing = groups.get(key);
      if (existing) existing.members.push(metric);
      else groups.set(key, { key, title, members: [metric] });
    }
  } else {
    // Literal-allowlist mode (existing behavior)
    const prefixSet = new Set(prefixAllowlist.map((p) => p.trim()).filter((p) => p.length > 0));
    const hasPrefixFilter = prefixSet.size > 0;

    for (const metric of metrics) {
      const { prefix, suffix } = splitMetricPath(metric);
      const suffixMatches = suffixSet.has(suffix);
      const prefixEligible = !hasPrefixFilter || prefixSet.has(prefix);

      if (suffixMatches && prefixEligible && prefix.length > 0) {
        const existing = groups.get(prefix);
        if (existing) existing.members.push(metric);
        else groups.set(prefix, { key: prefix, title: prefix, members: [metric] });
      } else {
        passthrough.push(metric);
      }
    }
  }

  // Singleton groups → passthrough (no point in a combined widget of one)
  for (const [key, group] of groups) {
    if (group.members.length < 2) {
      passthrough.push(...group.members);
      groups.delete(key);
    }
  }

  return { groups, passthrough };
}
