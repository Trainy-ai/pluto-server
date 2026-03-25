/**
 * Client-side validation for regex patterns before sending to ClickHouse.
 *
 * ClickHouse uses Google's re2 regex engine which has stricter requirements
 * than JavaScript's built-in RegExp. This validates patterns are re2-compatible
 * to prevent CANNOT_COMPILE_REGEXP errors (Code 427).
 */

/**
 * Validate that a regex pattern will compile in ClickHouse's re2 engine.
 * Returns true if valid, false if it would fail.
 */
export function isValidRe2Regex(pattern: string): boolean {
  const trimmed = pattern.trim();
  if (!trimmed) {
    return false;
  }

  // First check JS RegExp validity
  try {
    new RegExp(trimmed);
  } catch {
    return false;
  }

  // Backreferences: \1, \2, etc. — not supported by re2
  if (/\\[1-9]/.test(trimmed)) {
    return false;
  }

  // Lookahead/lookbehind: (?=, (?!, (?<=, (?<! — not supported by re2
  if (/\(\?[=!<]/.test(trimmed)) {
    return false;
  }

  // Atomic groups: (?>...) — not supported by re2
  if (/\(\?>/.test(trimmed)) {
    return false;
  }

  // Possessive quantifiers: *+, ++, ?+, {n}+ — not supported by re2
  if (/[*+?]\+|\}\+/.test(trimmed)) {
    return false;
  }

  // Check balanced parentheses (accounts for escaped parens and char classes)
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
        return false;
      }
    }
  }

  return depth === 0;
}
