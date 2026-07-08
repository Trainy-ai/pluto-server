import { describe, it, expect } from "vitest";
import { COLORS_KELLY_DARK } from "@/components/ui/color-picker";
import { bucketColorFor } from "../bucket-color";

describe("bucketColorFor", () => {
  it("returns a palette color", () => {
    const color = bucketColorFor("foo");
    expect(COLORS_KELLY_DARK).toContain(color);
  });

  it("is deterministic — same key → same color", () => {
    const a = bucketColorFor('[{"field":"tag-prefix:group","value":"ca"}]');
    const b = bucketColorFor('[{"field":"tag-prefix:group","value":"ca"}]');
    expect(a).toBe(b);
  });

  it("different keys generally pick different colors", () => {
    // Five distinct bucket trails — at least three should land on
    // three distinct palette entries (loose check; collisions over a
    // 24-color palette are expected but not on every input).
    const colors = new Set([
      bucketColorFor('[{"field":"tag-prefix:group","value":"ca"}]'),
      bucketColorFor('[{"field":"tag-prefix:group","value":"dog"}]'),
      bucketColorFor('[{"field":"tag-prefix:group","value":"bog"}]'),
      bucketColorFor('[{"field":"tag-prefix:group","value":"cat"}]'),
      bucketColorFor('[{"field":"tag-prefix:group","value":null}]'),
    ]);
    expect(colors.size).toBeGreaterThanOrEqual(3);
  });

  it("empty string still returns a palette color (top-level/no trail)", () => {
    expect(COLORS_KELLY_DARK).toContain(bucketColorFor(""));
  });
});
