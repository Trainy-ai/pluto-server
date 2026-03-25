/**
 * Validates regex patterns for ClickHouse re2 compatibility.
 *
 * ClickHouse uses Google's re2 regex engine, which differs from JavaScript's:
 * - No backreferences (\1, \2, etc.)
 * - No lookahead/lookbehind (?=, ?!, ?<=, ?<!)
 * - Stricter parenthesis balancing
 * - No possessive quantifiers (++, *+, ?+)
 * - No atomic groups (?>...)
 *
 * This module catches invalid patterns BEFORE they reach ClickHouse,
 * preventing CANNOT_COMPILE_REGEXP errors (Code 427).
 */

/**
 * Validate that a regex pattern is compatible with re2.
 * Returns { valid: true } or { valid: false, reason: string }.
 */
export function validateRe2Regex(pattern: string): {
  valid: boolean;
  reason?: string;
} {
  const trimmed = pattern?.trim();
  if (!trimmed) {
    return { valid: false, reason: "Empty pattern" };
  }

  // Check for features unsupported by re2
  // Backreferences: \1, \2, etc.
  if (/\\[1-9]/.test(trimmed)) {
    return { valid: false, reason: "Backreferences are not supported by re2" };
  }

  // Lookahead/lookbehind: (?=, (?!, (?<=, (?<!
  if (/\(\?[=!<]/.test(trimmed)) {
    return {
      valid: false,
      reason: "Lookahead/lookbehind assertions are not supported by re2",
    };
  }

  // Atomic groups: (?>...)
  if (/\(\?>/.test(trimmed)) {
    return { valid: false, reason: "Atomic groups are not supported by re2" };
  }

  // Possessive quantifiers: *+, ++, ?+, {n}+
  if (/[*+?]\+|\}\+/.test(trimmed)) {
    return {
      valid: false,
      reason: "Possessive quantifiers are not supported by re2",
    };
  }

  // Check balanced parentheses (the most common cause of CANNOT_COMPILE_REGEXP)
  // Must account for escaped parens \( \) and character classes [()]
  let depth = 0;
  let inCharClass = false;
  let escaped = false;
  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (ch === "\\") {
      escaped = true;
      continue;
    }

    if (ch === "[" && !inCharClass) {
      inCharClass = true;
      continue;
    }

    if (ch === "]" && inCharClass) {
      inCharClass = false;
      continue;
    }

    if (inCharClass) {
      continue;
    }

    if (ch === "(") {
      depth++;
    } else if (ch === ")") {
      depth--;
      if (depth < 0) {
        return { valid: false, reason: "Unbalanced parentheses: extra ')'" };
      }
    }
  }

  if (depth !== 0) {
    return {
      valid: false,
      reason: `Unbalanced parentheses: ${depth} unclosed '('`,
    };
  }

  // Also try to compile with JS RegExp as a basic syntax check
  // (this catches things like invalid character class ranges, bad quantifiers, etc.)
  try {
    new RegExp(trimmed);
  } catch {
    return { valid: false, reason: "Invalid regex syntax" };
  }

  return { valid: true };
}
