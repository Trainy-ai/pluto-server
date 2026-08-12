import { describe, it, expect } from "vitest";
import { formatDuration, terminalEndTime } from "../format-duration";

describe("terminalEndTime", () => {
  it("prefers statusUpdated over updatedAt", () => {
    const statusUpdated = new Date("2026-08-07T22:23:59.000Z");
    const updatedAt = new Date("2026-08-12T03:45:54.000Z");
    expect(terminalEndTime({ statusUpdated, updatedAt })).toEqual(statusUpdated);
  });

  it("falls back to updatedAt when statusUpdated is null or absent", () => {
    const updatedAt = new Date("2026-08-12T03:45:54.000Z");
    expect(terminalEndTime({ statusUpdated: null, updatedAt })).toEqual(updatedAt);
    expect(terminalEndTime({ updatedAt })).toEqual(updatedAt);
  });

  it("accepts ISO strings, as served from the local query cache", () => {
    expect(
      terminalEndTime({
        statusUpdated: "2026-08-07T22:23:59.000Z",
        updatedAt: "2026-08-12T03:45:54.000Z",
      }),
    ).toEqual(new Date("2026-08-07T22:23:59.000Z"));
  });

  it("returns the source Date by reference so hook deps stay stable", () => {
    const statusUpdated = new Date("2026-08-07T22:23:59.000Z");
    const updatedAt = new Date("2026-08-12T03:45:54.000Z");
    expect(terminalEndTime({ statusUpdated, updatedAt })).toBe(statusUpdated);
    expect(terminalEndTime({ statusUpdated: null, updatedAt })).toBe(updatedAt);
  });

  it("measures a migrated run to its finish, not to a later metadata write", () => {
    // MFV-475: created 8/7 22:23:57Z, completed 2s later, row touched again on
    // 8/12 by an unrelated write. The summary card used to read 101h 21m 57s.
    const createdAt = new Date("2026-08-07T22:23:57.000Z");
    const run = {
      statusUpdated: new Date("2026-08-07T22:23:59.000Z"),
      updatedAt: new Date("2026-08-12T03:45:54.000Z"),
    };
    const ms = terminalEndTime(run).getTime() - createdAt.getTime();
    expect(formatDuration(ms)).toBe("2s");
    // What the bug rendered, pinned so a regression is unmistakable.
    expect(formatDuration(run.updatedAt.getTime() - createdAt.getTime())).toBe(
      "101h 21m 57s",
    );
  });
});

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
