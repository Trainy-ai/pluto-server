import { describe, expect, it } from "vitest";
import {
  formatDashboardVersionActor,
  formatDashboardVersionSource,
  getDashboardVersionBadges,
} from "../dashboard-version-history-format";

describe("dashboard version history helpers", () => {
  it("describes current restored versions without hiding their origin", () => {
    expect(
      getDashboardVersionBadges({
        isCurrent: true,
        restoredFromVersion: 2,
        source: "restore",
      }),
    ).toEqual(["Current", "Restore", "Restored v2"]);
  });

  it("formats known and unknown version sources", () => {
    expect(formatDashboardVersionSource("api")).toBe("API");
    expect(formatDashboardVersionSource("migration")).toBe("Imported");
    expect(formatDashboardVersionSource("automation")).toBe("automation");
  });

  it("uses a useful actor fallback for migrated snapshots", () => {
    expect(
      formatDashboardVersionActor({ id: "user-1", name: "Ada", image: null }),
    ).toBe("Ada");
    expect(formatDashboardVersionActor(null)).toBe("System");
  });
});
