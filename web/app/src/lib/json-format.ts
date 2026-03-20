/**
 * Shared JSON formatting utilities.
 */

/** Returns true if the string is a valid JSON object or array. */
export function isJsonString(str: string): boolean {
  if (typeof str !== "string") return false;
  const trimmed = str.trim();
  if (trimmed.length === 0) return false;
  const firstChar = trimmed[0];
  if (firstChar !== "{" && firstChar !== "[") return false;
  try {
    JSON.parse(trimmed);
    return true;
  } catch {
    return tryParseAsPython(trimmed) !== null;
  }
}

/**
 * Attempt to convert a Python repr string (single-quoted dicts/lists,
 * True/False/None) into a parseable JSON string.
 * Returns the parsed object on success, or null on failure.
 */
function tryParseAsPython(str: string): unknown {
  try {
    // Replace Python booleans and None with JSON equivalents.
    // Use word-boundary matching to avoid replacing inside strings.
    let converted = str
      .replace(/\bTrue\b/g, "true")
      .replace(/\bFalse\b/g, "false")
      .replace(/\bNone\b/g, "null");

    // Replace single-quoted strings with double-quoted strings.
    // This regex matches: single quote, then any sequence of
    // escaped single quotes (\') or non-single-quote chars, then closing single quote.
    // It avoids replacing apostrophes inside double-quoted strings.
    converted = converted.replace(
      /'((?:[^'\\]|\\.)*)'/g,
      (_match, content: string) => {
        // Escape any unescaped double quotes inside the content
        const escaped = content.replace(/\\'/g, "'").replace(/"/g, '\\"');
        return `"${escaped}"`;
      },
    );

    return JSON.parse(converted);
  } catch {
    return null;
  }
}

/**
 * Pretty-print a string if it's valid JSON (object or array) or Python repr.
 * Returns the formatted string, or the original value unchanged if not parseable.
 */
export function tryPrettyPrintJson(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]"))
  ) {
    // Try standard JSON first
    try {
      return JSON.stringify(JSON.parse(trimmed), null, 2);
    } catch {
      // Fall through to Python repr attempt
    }
    // Try Python repr conversion
    const parsed = tryParseAsPython(trimmed);
    if (parsed !== null) {
      return JSON.stringify(parsed, null, 2);
    }
  }
  return value;
}
