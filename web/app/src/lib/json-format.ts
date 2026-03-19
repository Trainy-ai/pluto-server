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
    return false;
  }
}

/**
 * Pretty-print a string if it's valid JSON (object or array).
 * Returns the formatted string, or the original value unchanged if not JSON.
 */
export function tryPrettyPrintJson(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]"))
  ) {
    try {
      return JSON.stringify(JSON.parse(trimmed), null, 2);
    } catch {
      return value;
    }
  }
  return value;
}
