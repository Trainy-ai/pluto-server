import { describe, it, expect } from "vitest";
import {
  FRONTEND_VERSION_COOKIE,
  isValidVersion,
  parseVersionsManifest,
  readVersionCookie,
  buildSetCookie,
  buildClearCookie,
} from "../frontend-version";

describe("frontend-version", () => {
  describe("isValidVersion", () => {
    it("accepts typical semver tags", () => {
      expect(isValidVersion("0.0.12")).toBe(true);
      expect(isValidVersion("1.2.3")).toBe(true);
      expect(isValidVersion("2024.06.11-abc123")).toBe(true);
      expect(isValidVersion("dev")).toBe(true);
    });

    it("rejects empty and traversal-shaped values", () => {
      expect(isValidVersion("")).toBe(false);
      expect(isValidVersion("..")).toBe(false);
      expect(isValidVersion("../secret")).toBe(false);
      expect(isValidVersion("0.0..1")).toBe(false);
      expect(isValidVersion("foo/bar")).toBe(false);
      expect(isValidVersion("foo bar")).toBe(false);
      expect(isValidVersion("a%2f")).toBe(false);
    });
  });

  describe("parseVersionsManifest", () => {
    it("parses a well-formed manifest", () => {
      const result = parseVersionsManifest({
        current: "0.0.12",
        versions: ["0.0.12", "0.0.11", "0.0.10"],
      });
      expect(result).toEqual({
        current: "0.0.12",
        versions: ["0.0.12", "0.0.11", "0.0.10"],
      });
    });

    it("defaults current to first version when missing/invalid", () => {
      expect(
        parseVersionsManifest({ versions: ["0.0.12", "0.0.11"] }),
      ).toEqual({ current: "0.0.12", versions: ["0.0.12", "0.0.11"] });
      expect(
        parseVersionsManifest({
          current: "../evil",
          versions: ["0.0.12"],
        }),
      ).toEqual({ current: "0.0.12", versions: ["0.0.12"] });
    });

    it("filters out invalid version entries", () => {
      const result = parseVersionsManifest({
        current: "0.0.12",
        versions: ["0.0.12", "../evil", "", 42, "0.0.11"],
      });
      expect(result).toEqual({
        current: "0.0.12",
        versions: ["0.0.12", "0.0.11"],
      });
    });

    it("returns null for unusable input", () => {
      expect(parseVersionsManifest(null)).toBeNull();
      expect(parseVersionsManifest("nope")).toBeNull();
      expect(parseVersionsManifest({})).toBeNull();
      expect(parseVersionsManifest({ versions: [] })).toBeNull();
      expect(parseVersionsManifest({ versions: ["../evil"] })).toBeNull();
    });
  });

  describe("readVersionCookie", () => {
    it("extracts the pinned version", () => {
      expect(readVersionCookie("mlop_fe_version=0.0.11")).toBe("0.0.11");
      expect(
        readVersionCookie("theme=dark; mlop_fe_version=0.0.11; foo=bar"),
      ).toBe("0.0.11");
    });

    it("decodes encoded values", () => {
      expect(readVersionCookie("mlop_fe_version=2024.06%2D11")).toBe(
        "2024.06-11",
      );
    });

    it("returns null when absent or empty", () => {
      expect(readVersionCookie("")).toBeNull();
      expect(readVersionCookie("theme=dark")).toBeNull();
      expect(readVersionCookie("mlop_fe_version=")).toBeNull();
    });

    it("does not match a cookie whose name merely ends with the key", () => {
      expect(readVersionCookie("not_mlop_fe_version=0.0.11")).toBeNull();
    });
  });

  describe("cookie builders", () => {
    it("builds a path-scoped set cookie", () => {
      const cookie = buildSetCookie("0.0.11");
      expect(cookie).toContain(`${FRONTEND_VERSION_COOKIE}=0.0.11`);
      expect(cookie).toContain("path=/");
      expect(cookie).toContain("max-age=2592000");
      expect(cookie).toContain("samesite=lax");
    });

    it("round-trips through readVersionCookie", () => {
      const cookie = buildSetCookie("2024.06-11");
      // emulate the browser exposing only "name=value" via document.cookie
      const nameValue = cookie.split(";")[0];
      expect(readVersionCookie(nameValue)).toBe("2024.06-11");
    });

    it("builds an expiring clear cookie", () => {
      const cookie = buildClearCookie();
      expect(cookie).toContain(`${FRONTEND_VERSION_COOKIE}=`);
      expect(cookie).toContain("max-age=0");
      expect(cookie).toContain("path=/");
    });
  });
});
