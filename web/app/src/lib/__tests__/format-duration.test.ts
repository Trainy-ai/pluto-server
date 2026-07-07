import { describe, it, expect } from "vitest";
import { formatDuration } from "../format-duration";

describe("formatDuration", () => {
  it("shows seconds only under a minute", () => {
    expect(formatDuration(5_000)).toBe("5s");
    expect(formatDuration(0)).toBe("0s");
  });

  it("shows minutes + seconds under an hour", () => {
    expect(formatDuration(90_000)).toBe("1m 30s");
  });

  it("shows hours + minutes + seconds", () => {
    expect(formatDuration(5_400_000)).toBe("1h 30m 0s");
  });

  it("handles multi-day durations as accumulated hours", () => {
    // 26h30m — the "ran cleanly for over a day" end of the spectrum
    expect(formatDuration(95_400_000)).toBe("26h 30m 0s");
  });

  it("collapses non-finite or negative input to 0s", () => {
    expect(formatDuration(-1)).toBe("0s");
    expect(formatDuration(Number.NaN)).toBe("0s");
    expect(formatDuration(Number.POSITIVE_INFINITY)).toBe("0s");
  });
});
