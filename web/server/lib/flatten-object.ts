/**
 * Server-side utility for flattening nested objects into dot-notation keys.
 */

/** Recursively flattens a nested object into dot-notation keys */
export function flattenObject(
  obj: unknown,
  prefix = "",
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  if (obj === null || obj === undefined) {
    return result;
  }

  if (typeof obj !== "object" || Array.isArray(obj)) {
    if (prefix) {
      result[prefix] = obj;
    }
    return result;
  }

  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    const newKey = prefix ? `${prefix}.${key}` : key;

    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      Object.assign(result, flattenObject(value, newKey));
    } else {
      result[newKey] = value;
    }
  }

  return result;
}
