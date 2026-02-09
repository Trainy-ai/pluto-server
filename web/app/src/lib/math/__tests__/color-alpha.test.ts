import { describe, it, expect } from "vitest";
import { applyAlpha } from "../color-alpha";

describe("applyAlpha", () => {
  describe("hex colors", () => {
    it("converts 6-digit hex to rgba", () => {
      expect(applyAlpha("#ff0000", 0.5)).toBe("rgba(255, 0, 0, 0.5)");
    });

    it("handles full opacity", () => {
      expect(applyAlpha("#ff0000", 1)).toBe("rgba(255, 0, 0, 1)");
    });

    it("handles zero opacity", () => {
      expect(applyAlpha("#ff0000", 0)).toBe("rgba(255, 0, 0, 0)");
    });

    it("handles mixed hex values", () => {
      expect(applyAlpha("#1a2b3c", 0.3)).toBe("rgba(26, 43, 60, 0.3)");
    });

    it("converts 3-digit shorthand hex to rgba", () => {
      expect(applyAlpha("#f00", 0.5)).toBe("rgba(255, 0, 0, 0.5)");
    });

    it("handles 3-digit hex with mixed values", () => {
      expect(applyAlpha("#abc", 0.7)).toBe("rgba(170, 187, 204, 0.7)");
    });
  });

  describe("rgb colors", () => {
    it("converts rgb() to rgba()", () => {
      expect(applyAlpha("rgb(255, 0, 0)", 0.5)).toBe("rgba(255, 0, 0, 0.5)");
    });

    it("handles rgb with no spaces", () => {
      expect(applyAlpha("rgb(100,200,50)", 0.8)).toBe("rgba(100,200,50, 0.8)");
    });
  });

  describe("hsl colors", () => {
    it("converts hsl() to hsla()", () => {
      expect(applyAlpha("hsl(216, 70%, 50%)", 0.5)).toBe(
        "hsla(216, 70%, 50%, 0.5)",
      );
    });
  });

  describe("rgba colors", () => {
    it("replaces existing alpha in rgba()", () => {
      expect(applyAlpha("rgba(255, 0, 0, 1)", 0.3)).toBe(
        "rgba(255, 0, 0, 0.3)",
      );
    });

    it("replaces decimal alpha in rgba()", () => {
      expect(applyAlpha("rgba(100, 200, 50, 0.8)", 0.1)).toBe(
        "rgba(100, 200, 50, 0.1)",
      );
    });
  });

  describe("hsla colors", () => {
    it("replaces existing alpha in hsla()", () => {
      expect(applyAlpha("hsla(216, 70%, 50%, 1)", 0.15)).toBe(
        "hsla(216, 70%, 50%, 0.15)",
      );
    });
  });

  describe("fallback", () => {
    it("returns color unchanged for unrecognized formats", () => {
      expect(applyAlpha("red", 0.5)).toBe("red");
    });
  });
});
