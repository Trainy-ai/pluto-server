import { describe, expect, it } from "vitest";
import { parseCliArgs, preflightMcp } from "../cli.js";
import { DEFAULT_MCP_URL, type McpProbeResult } from "../mcp.js";

describe("parseCliArgs", () => {
  it("defaults to claude, read-only, and the hosted MCP", () => {
    expect(parseCliArgs([])).toMatchObject({
      agent: "claude",
      port: 8377,
      allowWrites: false,
      mcpUrl: DEFAULT_MCP_URL,
    });
  });

  it("opts into writes and a self-hosted MCP", () => {
    expect(
      parseCliArgs(["--allow-writes", "--mcp-url", "https://mcp.corp.example/mcp/"]),
    ).toMatchObject({ allowWrites: true, mcpUrl: "https://mcp.corp.example/mcp/" });
  });

  it("allows the Pluto web origin by default and adds each --origin", () => {
    expect(parseCliArgs([]).allowedOrigins).toEqual(["https://pluto.trainy.ai"]);
    expect(
      parseCliArgs([
        "--origin",
        "https://pluto.corp.example/",
        "--origin",
        "http://localhost:3000",
      ]).allowedOrigins,
    ).toEqual([
      "https://pluto.trainy.ai",
      "https://pluto.corp.example",
      "http://localhost:3000",
    ]);
  });

  it("rejects an --origin that is not an http(s) origin", () => {
    expect(() => parseCliArgs(["--origin", "null"])).toThrow(/--origin/);
    expect(() =>
      parseCliArgs(["--origin", "https://pluto.corp.example/chat"]),
    ).toThrow(/--origin/);
  });

  it("rejects --token together with --rotate-token", () => {
    expect(parseCliArgs(["--rotate-token"]).rotateToken).toBe(true);
    expect(() => parseCliArgs(["--token", "x", "--rotate-token"])).toThrow(
      /--rotate-token/,
    );
  });

  it("rejects an MCP URL that is not http(s)", () => {
    expect(() => parseCliArgs(["--mcp-url", "file:///etc/passwd"])).toThrow(
      /--mcp-url/,
    );
  });

  it("no longer accepts --allowed-tools, which could re-grant writes", () => {
    expect(() => parseCliArgs(["--allowed-tools", "mcp__pluto"])).toThrow(
      /Unknown option/,
    );
  });

  it("allows --mcp-config only for claude", () => {
    expect(parseCliArgs(["--mcp-config", "/tmp/mcp.json"]).mcpConfigPath).toBe(
      "/tmp/mcp.json",
    );
    expect(() =>
      parseCliArgs(["--agent", "codex", "--mcp-config", "/tmp/mcp.json"]),
    ).toThrow(/--mcp-config/);
  });
});

describe("preflightMcp", () => {
  const probeReturning =
    (result: McpProbeResult, calls: string[][] = []) =>
    async (url: string, key: string) => {
      calls.push([url, key]);
      return result;
    };

  it("fails with setup instructions when PLUTO_API_KEY is missing", async () => {
    const calls: string[][] = [];
    const result = await preflightMcp(parseCliArgs([]), {}, probeReturning({ status: "ok" }, calls));
    expect(result.ok).toBe(false);
    expect(result.message).toContain("PLUTO_API_KEY");
    expect(result.message).toContain("/api-keys");
    expect(calls).toEqual([]);
  });

  it("probes the MCP with the key and passes when accepted", async () => {
    const calls: string[][] = [];
    const result = await preflightMcp(
      parseCliArgs([]),
      { PLUTO_API_KEY: "mlpi_x" },
      probeReturning({ status: "ok" }, calls),
    );
    expect(result.ok).toBe(true);
    expect(calls).toEqual([[DEFAULT_MCP_URL, "mlpi_x"]]);
  });

  it("fails when the MCP rejects the key", async () => {
    const result = await preflightMcp(
      parseCliArgs([]),
      { PLUTO_API_KEY: "mlpi_bad" },
      probeReturning({ status: "unauthorized" }),
    );
    expect(result.ok).toBe(false);
    expect(result.message).toContain("rejected");
  });

  it("warns but continues when the MCP is unreachable", async () => {
    const result = await preflightMcp(
      parseCliArgs([]),
      { PLUTO_API_KEY: "mlpi_x" },
      probeReturning({ status: "unreachable", reason: "ECONNREFUSED" }),
    );
    expect(result.ok).toBe(true);
    expect(result.message).toContain("ECONNREFUSED");
  });

  it("skips the key check when a custom MCP config is supplied", async () => {
    const calls: string[][] = [];
    const result = await preflightMcp(
      parseCliArgs(["--mcp-config", "/tmp/mcp.json"]),
      {},
      probeReturning({ status: "ok" }, calls),
    );
    expect(result.ok).toBe(true);
    expect(calls).toEqual([]);
  });
});
