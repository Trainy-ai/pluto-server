import { describe, it, expect } from "vitest";
import { validateRe2Regex } from "../lib/regex-validation";

describe("validateRe2Regex", () => {
  describe("valid patterns", () => {
    it("accepts simple patterns", () => {
      expect(validateRe2Regex("train/loss")).toEqual({ valid: true });
      expect(validateRe2Regex(".*loss.*")).toEqual({ valid: true });
      expect(validateRe2Regex("(train|eval)/.+")).toEqual({ valid: true });
    });

    it("accepts complex negative-match patterns (the dashboard pattern that caused 96 errors)", () => {
      // This is the actual pattern from the user's dashboard
      const pattern =
        "validation/([^f/][^/]*|f([^r/][^/]*)?|fr([^e/][^/]*)?|fre([^q/][^/]*)?|freq[^/]+)/.*scaled/CRPS";
      expect(validateRe2Regex(pattern)).toEqual({ valid: true });
    });

    it("accepts character classes with special chars", () => {
      expect(validateRe2Regex("[^f/][^/]*")).toEqual({ valid: true });
      expect(validateRe2Regex("test[0-9]+")).toEqual({ valid: true });
    });

    it("accepts escaped parentheses", () => {
      expect(validateRe2Regex("\\(literal\\)")).toEqual({ valid: true });
    });

    it("accepts nested groups", () => {
      expect(validateRe2Regex("(a(b(c)))")).toEqual({ valid: true });
    });
  });

  describe("unbalanced parentheses", () => {
    it("rejects missing closing paren", () => {
      const result = validateRe2Regex("(unclosed");
      expect(result.valid).toBe(false);
      expect(result.reason).toContain("Unbalanced parentheses");
    });

    it("rejects extra closing paren", () => {
      const result = validateRe2Regex("extra)");
      expect(result.valid).toBe(false);
      expect(result.reason).toContain("Unbalanced parentheses");
    });

    it("rejects truncated negative-match pattern (the actual error case)", () => {
      // This is what .max(200) truncation could produce
      const truncated =
        "validation/([^f/][^/]*|f([^r/][^/]*)?|fr([^e/][^/]*)?|fre([^q/][^/]*)?|freq[^/]+/.";
      const result = validateRe2Regex(truncated);
      expect(result.valid).toBe(false);
    });
  });

  describe("re2-unsupported features", () => {
    it("rejects backreferences", () => {
      const result = validateRe2Regex("(a)\\1");
      expect(result.valid).toBe(false);
      expect(result.reason).toContain("Backreferences");
    });

    it("rejects positive lookahead", () => {
      const result = validateRe2Regex("foo(?=bar)");
      expect(result.valid).toBe(false);
      expect(result.reason).toContain("Lookahead");
    });

    it("rejects negative lookahead", () => {
      const result = validateRe2Regex("foo(?!bar)");
      expect(result.valid).toBe(false);
      expect(result.reason).toContain("Lookahead");
    });

    it("rejects lookbehind", () => {
      const result = validateRe2Regex("(?<=foo)bar");
      expect(result.valid).toBe(false);
      expect(result.reason).toContain("Lookahead");
    });

    it("rejects atomic groups", () => {
      const result = validateRe2Regex("(?>abc)");
      expect(result.valid).toBe(false);
      expect(result.reason).toContain("Atomic groups");
    });

    it("rejects possessive quantifiers", () => {
      const result = validateRe2Regex("a*+b");
      expect(result.valid).toBe(false);
      expect(result.reason).toContain("Possessive quantifiers");
    });
  });

  describe("edge cases", () => {
    it("rejects empty patterns", () => {
      expect(validateRe2Regex("")).toEqual({
        valid: false,
        reason: "Empty pattern",
      });
      expect(validateRe2Regex("   ")).toEqual({
        valid: false,
        reason: "Empty pattern",
      });
    });

    it("handles parens inside character classes (should not count)", () => {
      // Parens inside [] are literal, not grouping
      expect(validateRe2Regex("[()]")).toEqual({ valid: true });
      expect(validateRe2Regex("[^(]+")).toEqual({ valid: true });
    });

    it("handles escaped parens (should not count)", () => {
      expect(validateRe2Regex("\\(not a group\\)")).toEqual({ valid: true });
    });
  });
});
