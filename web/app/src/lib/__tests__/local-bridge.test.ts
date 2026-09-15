import { beforeEach, describe, expect, it } from "vitest";
import {
  getLocalBridgeUrl,
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
