import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import {
  getLocalBridgeCommand,
  getLocalBridgeUrl,
  LOCAL_BRIDGE_VERSION,
  LOCAL_BRIDGE_STORAGE_KEY,
  loadLocalBridgeSettings,
  saveLocalBridgeSettings,
} from "../local-bridge";

describe("local bridge settings", () => {
  beforeEach(() => localStorage.clear());

  it("round-trips settings through localStorage", () => {
    saveLocalBridgeSettings({ port: 8377, token: "abc" });
    expect(loadLocalBridgeSettings()).toEqual({ port: 8377, token: "abc" });
    saveLocalBridgeSettings(null);
    expect(loadLocalBridgeSettings()).toBeNull();
  });

  it("returns null for missing, corrupt, or invalid entries", () => {
    expect(loadLocalBridgeSettings()).toBeNull();
    localStorage.setItem(LOCAL_BRIDGE_STORAGE_KEY, "not json");
    expect(loadLocalBridgeSettings()).toBeNull();
    localStorage.setItem(
      LOCAL_BRIDGE_STORAGE_KEY,
      JSON.stringify({ port: -1, token: "x" }),
    );
    expect(loadLocalBridgeSettings()).toBeNull();
    localStorage.setItem(
      LOCAL_BRIDGE_STORAGE_KEY,
      JSON.stringify({ port: 8377, token: "" }),
    );
    expect(loadLocalBridgeSettings()).toBeNull();
  });

  it("builds loopback URLs", () => {
    expect(getLocalBridgeUrl(8377, "/chat")).toBe("http://127.0.0.1:8377/chat");
  });
});

describe("local bridge command", () => {
  it("pins the version of the bridge package in this repo", () => {
    const packageJson = JSON.parse(
      readFileSync(
        path.resolve(
          __dirname,
          "../../../../../packages/pluto-bridge/package.json",
        ),
        "utf8",
      ),
    ) as { name: string; version: string };
    expect(packageJson.name).toBe("@trainy/pluto-bridge");
    expect(LOCAL_BRIDGE_VERSION).toBe(packageJson.version);
    expect(getLocalBridgeCommand("https://pluto.trainy.ai")).toBe(
      `npx @trainy/pluto-bridge@${packageJson.version}`,
    );
  });

  it("never tells customers to run an unpinned version", () => {
    expect(LOCAL_BRIDGE_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("allowlists any other origin the app is served from", () => {
    expect(getLocalBridgeCommand("http://localhost:3000")).toBe(
      `npx @trainy/pluto-bridge@${LOCAL_BRIDGE_VERSION} --origin http://localhost:3000`,
    );
  });
});
