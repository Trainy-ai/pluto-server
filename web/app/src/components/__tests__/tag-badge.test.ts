import { describe, it, expect } from "vitest";
import { parseTag } from "../tag-badge";

describe("parseTag", () => {
  describe("Linear tags", () => {
    it("parses linear:TRN-123 format", () => {
      const result = parseTag("linear:TRN-123");

      expect(result.type).toBe("linear");
      expect(result.display).toBe("TRN-123");
      expect(result.issueId).toBe("TRN-123");
      expect(result.url).toBe("https://linear.app/issue/TRN-123");
    });

    it("parses linear:ABC-456 format", () => {
      const result = parseTag("linear:ABC-456");

      expect(result.type).toBe("linear");
      expect(result.display).toBe("ABC-456");
      expect(result.issueId).toBe("ABC-456");
      expect(result.url).toBe("https://linear.app/issue/ABC-456");
    });

    it("normalizes lowercase issue IDs to uppercase", () => {
      const result = parseTag("linear:trn-123");

      expect(result.type).toBe("linear");
      expect(result.display).toBe("TRN-123");
      expect(result.issueId).toBe("TRN-123");
      expect(result.url).toBe("https://linear.app/issue/TRN-123");
    });

    it("handles mixed case issue IDs", () => {
      const result = parseTag("linear:Trn-999");

      expect(result.type).toBe("linear");
      expect(result.display).toBe("TRN-999");
      expect(result.issueId).toBe("TRN-999");
      expect(result.url).toBe("https://linear.app/issue/TRN-999");
    });

    it("handles long team prefixes", () => {
      const result = parseTag("linear:PLATFORM-12345");

      expect(result.type).toBe("linear");
      expect(result.display).toBe("PLATFORM-12345");
      expect(result.issueId).toBe("PLATFORM-12345");
      expect(result.url).toBe("https://linear.app/issue/PLATFORM-12345");
    });
  });

  describe("plain tags", () => {
    it("returns plain type for regular tags", () => {
      const result = parseTag("experiment-v1");

      expect(result.type).toBe("plain");
      expect(result.display).toBe("experiment-v1");
      expect(result.url).toBeUndefined();
      expect(result.issueId).toBeUndefined();
    });

    it("does not match invalid linear format (missing number)", () => {
      const result = parseTag("linear:TRN");

      expect(result.type).toBe("plain");
      expect(result.display).toBe("linear:TRN");
    });

    it("does not match invalid linear format (no dash)", () => {
      const result = parseTag("linear:TRN123");

      expect(result.type).toBe("plain");
      expect(result.display).toBe("linear:TRN123");
    });

    it("does not match invalid linear format (starts with number)", () => {
      const result = parseTag("linear:123-TRN");

      expect(result.type).toBe("plain");
      expect(result.display).toBe("linear:123-TRN");
    });

    it("does not match partial linear prefix", () => {
      const result = parseTag("linearTRN-123");

      expect(result.type).toBe("plain");
      expect(result.display).toBe("linearTRN-123");
    });

    it("does not match linear prefix with extra content", () => {
      const result = parseTag("linear:TRN-123-extra");

      expect(result.type).toBe("plain");
      expect(result.display).toBe("linear:TRN-123-extra");
    });

    it("handles empty string", () => {
      const result = parseTag("");

      expect(result.type).toBe("plain");
      expect(result.display).toBe("");
    });

    it("handles tags with colons", () => {
      const result = parseTag("env:production");

      expect(result.type).toBe("plain");
      expect(result.display).toBe("env:production");
    });
  });
});
