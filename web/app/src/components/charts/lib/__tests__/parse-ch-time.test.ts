import { describe, it, expect } from "vitest";
import { parseChTimeMs } from "../format";

describe("parseChTimeMs", () => {
  // The known UTC epoch ms for 2026-03-16T02:21:32.278Z
  const KNOWN_UTC_MS = Date.UTC(2026, 2, 16, 2, 21, 32, 278);

  it("parses ClickHouse naive datetime string as UTC", () => {
    // ClickHouse returns DateTime64(3) without timezone suffix
    const result = parseChTimeMs("2026-03-16 02:21:32.278");
    expect(result).toBe(KNOWN_UTC_MS);
  });

  it("parses ISO 8601 string with Z suffix correctly", () => {
    const result = parseChTimeMs("2026-03-16T02:21:32.278Z");
    expect(result).toBe(KNOWN_UTC_MS);
  });

  it("parses ISO 8601 string with +00:00 offset correctly", () => {
    const result = parseChTimeMs("2026-03-16T02:21:32.278+00:00");
    expect(result).toBe(KNOWN_UTC_MS);
  });

  it("parses ISO 8601 string with non-UTC offset correctly", () => {
    // 2026-03-16T09:21:32.278+07:00 is the same instant as 02:21:32.278Z
    const result = parseChTimeMs("2026-03-16T09:21:32.278+07:00");
    expect(result).toBe(KNOWN_UTC_MS);
  });

  it("naive string and Z-suffixed string produce the same result", () => {
    // This is the core invariant: a naive ClickHouse string and a
    // Z-suffixed PostgreSQL string for the same UTC instant must agree.
    const naive = parseChTimeMs("2026-03-16 02:21:32.278");
    const withZ = parseChTimeMs("2026-03-16T02:21:32.278Z");
    expect(naive).toBe(withZ);
  });

  it("handles whole-second timestamps", () => {
    const result = parseChTimeMs("2026-03-16 02:21:32");
    const expected = Date.UTC(2026, 2, 16, 2, 21, 32, 0);
    expect(result).toBe(expected);
  });

  it("handles date-only strings", () => {
    const result = parseChTimeMs("2026-03-16");
    const expected = Date.UTC(2026, 2, 16);
    expect(result).toBe(expected);
  });
});
