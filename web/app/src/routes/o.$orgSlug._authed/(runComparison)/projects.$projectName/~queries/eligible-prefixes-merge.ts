export interface EligiblePrefixEntry {
  prefix: string;
  suffixCount: number;
}

/**
 * Pure merge of per-run + project-wide eligible-prefix responses into a
 * single sorted, ancestor-suppressed list. Extracted from the hook so
 * the merge contract can be unit-tested without touching React Query.
 *
 * Rules:
 *  - Same prefix appearing in multiple sources → take the MAX suffixCount.
 *  - Drop any prefix that is a strict ancestor of another in the result
 *    set (deepest-only).
 *  - Sort by suffixCount desc, then prefix asc.
 */
export function mergeEligiblePrefixes(
  perRun: ReadonlyArray<ReadonlyArray<EligiblePrefixEntry> | undefined>,
  projectWide: ReadonlyArray<EligiblePrefixEntry> | undefined,
): EligiblePrefixEntry[] {
  const acc = new Map<string, number>();
  const ingest = (rows: ReadonlyArray<EligiblePrefixEntry> | undefined) => {
    for (const r of rows ?? []) {
      const cur = acc.get(r.prefix) ?? 0;
      if (r.suffixCount > cur) acc.set(r.prefix, r.suffixCount);
    }
  };
  for (const rows of perRun) ingest(rows);
  ingest(projectWide);
  const all = Array.from(acc.entries()).map(([prefix, suffixCount]) => ({
    prefix,
    suffixCount,
  }));
  const prefixSet = new Set(all.map((e) => e.prefix));
  const filtered = all.filter(
    (e) =>
      ![...prefixSet].some(
        (other) => other !== e.prefix && other.startsWith(e.prefix),
      ),
  );
  return filtered.sort((a, b) => {
    if (b.suffixCount !== a.suffixCount) return b.suffixCount - a.suffixCount;
    return a.prefix.localeCompare(b.prefix);
  });
}
