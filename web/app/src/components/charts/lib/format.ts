// ============================
// Axis / Value Formatting — Pure Functions
// ============================

/** Format a single value with SI units (k, M, G, etc.) */
export function formatAxisLabel(value: number | null | undefined): string {
  if (value == null) return "";
  if (value === 0) return "0";
  if (Math.abs(value) < 0.0001) {
    return value.toExponential(2).replace(/\.?0+e/, "e");
  }
  const units = [
    { limit: 1e18, suffix: "E" },
    { limit: 1e15, suffix: "P" },
    { limit: 1e12, suffix: "T" },
    { limit: 1e9, suffix: "G" },
    { limit: 1e6, suffix: "M" },
    { limit: 1e3, suffix: "k" },
  ];
  for (const { limit, suffix } of units) {
    if (Math.abs(value) >= limit) {
      return `${(value / limit).toPrecision(4).replace(/\.?0+$/, "")}${suffix}`;
    }
  }
  return Number(value).toPrecision(4).replace(/\.?0+$/, "");
}

/**
 * Range-aware axis label formatter.
 * When zoomed in, abbreviated format (e.g. "52.95k") can produce duplicate labels
 * for nearby tick values. This detects duplicates and falls back to full precision.
 */
export function formatAxisLabels(vals: (number | null | undefined)[]): string[] {
  if (vals.length === 0) return [];

  // Try abbreviated format first
  const abbreviated = vals.map((v) => formatAxisLabel(v));
  const uniqueCount = new Set(abbreviated).size;

  // If all labels are already unique, abbreviated is fine
  if (uniqueCount === abbreviated.length) {
    return abbreviated;
  }

  // Filter to non-null values for spacing/precision calculations
  const nonNull = vals.filter((v): v is number => v != null);
  if (nonNull.length < 2) return abbreviated;

  // Ticks have duplicates — need more precision
  const spacing = Math.abs(nonNull[1] - nonNull[0]);

  // For integer-spaced values (step axes), show full integers with commas
  if (spacing >= 1 && nonNull.every((v) => Number.isInteger(v))) {
    return vals.map((v) => (v == null ? "" : v.toLocaleString()));
  }

  // For decimal spacing, show enough decimal places to differentiate
  const decimals = Math.max(0, Math.ceil(-Math.log10(spacing)) + 1);
  return vals.map((v) => (v == null ? "" : v.toFixed(Math.min(decimals, 10))));
}

/** Format a step/x value for the tooltip header with full precision. */
export function formatStepValue(value: number): string {
  if (Number.isInteger(value)) {
    return value.toLocaleString();
  }
  // For non-integer values, show enough precision to be useful
  return value.toPrecision(6).replace(/\.?0+$/, "");
}

/** Smart date formatter based on range */
export function smartDateFormatter(value: number, range: number): string {
  const userTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const localDate = new Date(value);

  const oneMinute = 60000;
  const oneHour = 3600000;
  const oneDay = 86400000;
  const oneWeek = 7 * oneDay;
  const oneMonth = 30 * oneDay;
  const oneYear = 365 * oneDay;

  if (range < 10 * oneMinute) {
    return localDate.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      timeZone: userTimezone,
    });
  } else if (range < 2 * oneHour) {
    return localDate.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      timeZone: userTimezone,
      hour12: false,
    });
  } else if (range < oneDay) {
    return localDate.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: userTimezone,
      hour12: false,
    });
  } else if (range < oneWeek) {
    return localDate.toLocaleDateString([], {
      weekday: "short",
      day: "numeric",
      timeZone: userTimezone,
    });
  } else if (range < oneMonth) {
    return localDate.toLocaleDateString([], {
      month: "short",
      day: "numeric",
      timeZone: userTimezone,
    });
  } else if (range < oneYear) {
    return localDate.toLocaleDateString([], {
      month: "short",
      day: "numeric",
      timeZone: userTimezone,
    });
  } else if (range < 5 * oneYear) {
    return localDate.toLocaleDateString([], {
      month: "short",
      year: "numeric",
      timeZone: userTimezone,
    });
  } else {
    return localDate.toLocaleDateString([], {
      year: "numeric",
      timeZone: userTimezone,
    });
  }
}
