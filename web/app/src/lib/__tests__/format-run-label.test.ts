import { describe, it, expect } from "vitest";
import { formatRunLabel } from "../format-run-label";

describe("formatRunLabel", () => {
  it("returns run name with display ID when displayId is provided", () => {
    expect(formatRunLabel("training-v2", "MMP-42")).toBe("training-v2 (MMP-42)");
  });

  it("returns just the run name when displayId is null", () => {
    expect(formatRunLabel("training-v2", null)).toBe("training-v2");
  });

  it("returns just the run name when displayId is undefined", () => {
    expect(formatRunLabel("training-v2", undefined)).toBe("training-v2");
  });

  it("returns just the run name when displayId is empty string", () => {
    expect(formatRunLabel("training-v2", "")).toBe("training-v2");
  });

  it("handles runs with the same name but different display IDs", () => {
    const label1 = formatRunLabel("my-run", "EXP-1");
    const label2 = formatRunLabel("my-run", "EXP-2");
    expect(label1).not.toBe(label2);
    expect(label1).toBe("my-run (EXP-1)");
    expect(label2).toBe("my-run (EXP-2)");
  });
});
