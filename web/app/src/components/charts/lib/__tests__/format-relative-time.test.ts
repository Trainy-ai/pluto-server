import { describe, it, expect } from "vitest";
import { formatDuration, formatRelativeTimeValue, formatRelativeTimeValues } from "../format";

describe("formatDuration", () => {
  it("formats zero", () => {
    expect(formatDuration(0)).toBe("0s");
  });

  it("formats pure seconds", () => {
    expect(formatDuration(1)).toBe("1s");
    expect(formatDuration(30)).toBe("30s");
    expect(formatDuration(59)).toBe("59s");
  });

  it("formats fractional seconds", () => {
    expect(formatDuration(0.5)).toBe("0.5s");
    expect(formatDuration(42.3)).toBe("42.3s");
  });

  it("formats minutes", () => {
    expect(formatDuration(60)).toBe("1m");
    expect(formatDuration(120)).toBe("2m");
    expect(formatDuration(300)).toBe("5m");
  });

  it("formats minutes + seconds", () => {
    expect(formatDuration(90)).toBe("1m30s");
    expect(formatDuration(119)).toBe("1m59s");
    expect(formatDuration(445)).toBe("7m25s");
    expect(formatDuration(468)).toBe("7m48s");
  });

  it("formats hours", () => {
    expect(formatDuration(3600)).toBe("1h");
    expect(formatDuration(7200)).toBe("2h");
    expect(formatDuration(36000)).toBe("10h");
  });

  it("formats hours + minutes", () => {
    expect(formatDuration(5400)).toBe("1h30m");
    expect(formatDuration(9000)).toBe("2h30m");
  });

  it("formats hours + minutes + seconds", () => {
    expect(formatDuration(3661)).toBe("1h1m1s");
  });

  it("formats days", () => {
    expect(formatDuration(86400)).toBe("1d");
    expect(formatDuration(172800)).toBe("2d");
    expect(formatDuration(864000)).toBe("10d");
  });

  it("formats days + hours", () => {
    expect(formatDuration(216000)).toBe("2d12h");
    expect(formatDuration(90000)).toBe("1d1h");
  });

  it("formats all components", () => {
    expect(formatDuration(90061)).toBe("1d1h1m1s");
  });

  it("handles negative values", () => {
    expect(formatDuration(-60)).toBe("-1m");
    expect(formatDuration(-3661)).toBe("-1h1m1s");
  });

  it("handles fractional seconds with minutes", () => {
    expect(formatDuration(99.9)).toBe("1m39.9s");
    expect(formatDuration(150.5)).toBe("2m30.5s");
  });
});

describe("formatRelativeTimeValue", () => {
  it("delegates to formatDuration", () => {
    expect(formatRelativeTimeValue(0)).toBe("0s");
    expect(formatRelativeTimeValue(90)).toBe("1m30s");
    expect(formatRelativeTimeValue(3661)).toBe("1h1m1s");
    expect(formatRelativeTimeValue(86400)).toBe("1d");
  });
});

describe("formatRelativeTimeValues", () => {
  describe("empty / null handling", () => {
    it("returns empty strings for empty array", () => {
      expect(formatRelativeTimeValues([])).toEqual([]);
    });

    it("returns empty strings for all-null array", () => {
      expect(formatRelativeTimeValues([null, null, null])).toEqual(["", "", ""]);
    });

    it("preserves null positions as empty strings", () => {
      const result = formatRelativeTimeValues([0, null, 60]);
      expect(result).toEqual(["0s", "", "1m"]);
    });
  });

  describe("real-world scenarios", () => {
    it("zoomed-in training run (few seconds)", () => {
      const result = formatRelativeTimeValues([10.5, 11, 11.5, 12, 12.5]);
      expect(result).toEqual(["10.5s", "11s", "11.5s", "12s", "12.5s"]);
    });

    it("short range (< 2 minutes)", () => {
      const result = formatRelativeTimeValues([0, 30, 60, 90]);
      expect(result).toEqual(["0s", "30s", "1m", "1m30s"]);
    });

    it("typical training run (~20 minutes)", () => {
      const result = formatRelativeTimeValues([0, 300, 600, 900, 1200]);
      expect(result).toEqual(["0s", "5m", "10m", "15m", "20m"]);
    });

    it("medium range with mixed components", () => {
      const result = formatRelativeTimeValues([600, 1800, 3000, 4200, 5400, 6600]);
      expect(result).toEqual(["10m", "30m", "50m", "1h10m", "1h30m", "1h50m"]);
    });

    it("long training run (~24 hours)", () => {
      const result = formatRelativeTimeValues([0, 21600, 43200, 64800, 86400]);
      expect(result).toEqual(["0s", "6h", "12h", "18h", "1d"]);
    });

    it("multi-day training run", () => {
      const result = formatRelativeTimeValues([0, 86400, 172800, 259200, 345600]);
      expect(result).toEqual(["0s", "1d", "2d", "3d", "4d"]);
    });

    it("fractional seconds in axis ticks", () => {
      const result = formatRelativeTimeValues([0, 59.5, 119]);
      expect(result).toEqual(["0s", "59.5s", "1m59s"]);
    });

    it("exact minute boundaries", () => {
      const result = formatRelativeTimeValues([0, 60, 120]);
      expect(result).toEqual(["0s", "1m", "2m"]);
    });

    it("minute + second ticks", () => {
      const result = formatRelativeTimeValues([0, 90, 180]);
      expect(result).toEqual(["0s", "1m30s", "3m"]);
    });

    it("exact hour boundaries", () => {
      const result = formatRelativeTimeValues([0, 3600, 7200]);
      expect(result).toEqual(["0s", "1h", "2h"]);
    });

    it("exact day boundaries", () => {
      const result = formatRelativeTimeValues([0, 86400, 172800]);
      expect(result).toEqual(["0s", "1d", "2d"]);
    });
  });
});
