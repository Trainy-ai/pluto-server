/**
 * Shared utility for flattening nested objects into dot-notation keys
 * and formatting values for display.
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

/** Formats any unknown value to a display string */
export function formatValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "-";
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  if (typeof value === "number") {
    // Scientific notation for very small/large values (integers and floats alike)
    const abs = Math.abs(value);
    if (abs !== 0 && (abs < 0.001 || abs >= 1e6)) {
      return value.toExponential(9).replace(/\.?0+(e)/i, "$1");
    }
    // Normal-range integers: locale string (99999 → "99,999")
    if (Number.isInteger(value)) {
      return value.toLocaleString();
    }
    return value.toLocaleString(undefined, { maximumFractionDigits: 6 });
  }
  if (Array.isArray(value)) {
    return JSON.stringify(value);
  }
  if (typeof value === "object") {
    return JSON.stringify(value);
  }
  // Coerce numeric strings to numbers for proper formatting:
  // - Strings with decimals: strip trailing zeros (e.g. "0.0003000" → "0.0003")
  // - Integer strings: only if they don't have leading zeros (preserves IDs like "007")
  if (typeof value === "string" && value.trim() !== "") {
    const trimmed = value.trim();
    const hasDecimal = trimmed.includes(".");
    const hasLeadingZero = !hasDecimal && trimmed.length > 1 && trimmed.startsWith("0");
    if (hasDecimal || !hasLeadingZero) {
      const num = Number(trimmed);
      if (!isNaN(num) && isFinite(num)) {
        return formatValue(num);
      }
    }
  }
  return String(value);
}
