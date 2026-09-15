import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
  mkdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { resolveToken, tokenPath } from "../token.js";

const mode = (path: string) => statSync(path).mode & 0o777;

describe("tokenPath", () => {
  it("uses XDG_CONFIG_HOME when set", () => {
    expect(tokenPath({ XDG_CONFIG_HOME: "/xdg" }, "/home/u")).toBe(
      "/xdg/pluto-bridge/token",
    );
  });

  it("falls back to ~/.config", () => {
    expect(tokenPath({}, "/home/u")).toBe("/home/u/.config/pluto-bridge/token");
  });
});

describe("resolveToken", () => {
  let dir: string;
  let path: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "pluto-bridge-token-"));
    path = join(dir, "config", "pluto-bridge", "token");
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("creates a token on first start, readable only by the user", () => {
    const first = resolveToken({ path });
    expect(first.source).toBe("created");
    expect(first.token).toMatch(/^[0-9a-f]{32}$/);
    expect(readFileSync(path, "utf8").trim()).toBe(first.token);
    expect(mode(path)).toBe(0o600);
    expect(mode(dirname(path))).toBe(0o700);
  });

  it("reuses the stored token on later starts so pairing survives restarts", () => {
    const first = resolveToken({ path });
    expect(resolveToken({ path })).toEqual({ token: first.token, source: "stored" });
  });

  it("uses --token without writing it", () => {
    expect(resolveToken({ path, token: "from-flag" })).toEqual({
      token: "from-flag",
      source: "flag",
    });
    expect(() => statSync(path)).toThrow();
  });

  it("replaces the stored token with --rotate-token", () => {
    const first = resolveToken({ path });
    const rotated = resolveToken({ path, rotate: true });
    expect(rotated.source).toBe("rotated");
    expect(rotated.token).not.toBe(first.token);
    expect(resolveToken({ path }).token).toBe(rotated.token);
    expect(mode(path)).toBe(0o600);
  });

  it("replaces a corrupt stored token", () => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, "not a token\n");
    const result = resolveToken({ path });
    expect(result.source).toBe("created");
    expect(result.token).toMatch(/^[0-9a-f]{32}$/);
  });

  it("tightens a stored token file that others can read", () => {
    const first = resolveToken({ path });
    chmodSync(path, 0o644);
    expect(resolveToken({ path }).token).toBe(first.token);
    expect(mode(path)).toBe(0o600);
  });
});
