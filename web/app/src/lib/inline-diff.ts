/**
 * Word-level inline diff utility for the side-by-side comparison view.
 * Uses LCS (Longest Common Subsequence) on word tokens to produce
 * fine-grained "added"/"removed"/"equal" spans.
 */

export interface DiffSpan {
  text: string;
  type: "equal" | "added" | "removed";
}

const MAX_TOKENS = 500;

/**
 * Tokenize a string on word boundaries: whitespace, path separators,
 * underscores, hyphens, colons, commas, equals, brackets, braces, quotes.
 * Each separator is its own token so whitespace/punctuation is preserved in output.
 */
export function tokenize(str: string): string[] {
  return str.match(/[\w.]+|[^\w.]/g) ?? [];
}

/**
 * Standard LCS length table (bottom-up DP).
 * Returns the DP table for back-tracking.
 */
function lcsTable(a: string[], b: string[]): number[][] {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }
  return dp;
}

/** Merge consecutive spans of the same type into one. */
function mergeSpans(spans: DiffSpan[]): DiffSpan[] {
  if (spans.length === 0) return spans;
  const merged: DiffSpan[] = [spans[0]];
  for (let i = 1; i < spans.length; i++) {
    const prev = merged[merged.length - 1];
    if (spans[i].type === prev.type) {
      prev.text += spans[i].text;
    } else {
      merged.push({ ...spans[i] });
    }
  }
  return merged;
}

/**
 * Compute inline word-level diff between a reference string and another string.
 * Returns `undefined` if either string exceeds the token limit (fall back to cell-level diff).
 */
export function computeInlineDiff(
  reference: string,
  other: string,
): { refSpans: DiffSpan[]; otherSpans: DiffSpan[] } | undefined {
  if (reference === other) return undefined;

  const refTokens = tokenize(reference);
  const otherTokens = tokenize(other);

  if (refTokens.length > MAX_TOKENS || otherTokens.length > MAX_TOKENS) {
    return undefined;
  }

  const dp = lcsTable(refTokens, otherTokens);

  // Back-track to produce ref spans and other spans
  const refSpans: DiffSpan[] = [];
  const otherSpans: DiffSpan[] = [];

  let i = refTokens.length;
  let j = otherTokens.length;

  // We'll build spans in reverse, then reverse at the end
  const refReversed: DiffSpan[] = [];
  const otherReversed: DiffSpan[] = [];

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && refTokens[i - 1] === otherTokens[j - 1]) {
      refReversed.push({ text: refTokens[i - 1], type: "equal" });
      otherReversed.push({ text: otherTokens[j - 1], type: "equal" });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      otherReversed.push({ text: otherTokens[j - 1], type: "added" });
      j--;
    } else {
      refReversed.push({ text: refTokens[i - 1], type: "removed" });
      i--;
    }
  }

  refReversed.reverse();
  otherReversed.reverse();

  return {
    refSpans: mergeSpans(refReversed),
    otherSpans: mergeSpans(otherReversed),
  };
}
