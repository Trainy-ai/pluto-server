/**
 * Recursively merges `source` into `target`.
 * - Plain objects are merged key-by-key.
 * - Arrays and primitives in `source` overwrite the corresponding key in `target`.
 * - Returns a new object; neither input is mutated.
 */
export function deepMerge(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...target };

  for (const [key, sourceVal] of Object.entries(source)) {
    const targetVal = result[key];

    if (
      isPlainObject(targetVal) &&
      isPlainObject(sourceVal)
    ) {
      result[key] = deepMerge(
        targetVal as Record<string, unknown>,
        sourceVal as Record<string, unknown>,
      );
    } else {
      result[key] = sourceVal;
    }
  }

  return result;
}

function isPlainObject(val: unknown): val is Record<string, unknown> {
  return val !== null && typeof val === "object" && !Array.isArray(val);
}
