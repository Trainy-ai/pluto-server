import { afterEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import {
  API_KEY_ENV,
  claudeMcpConfig,
  codexMcpOverrides,
  DEFAULT_MCP_URL,
  probeMcp,
} from "../mcp.js";

describe("claudeMcpConfig", () => {
  it("points a pluto http server at the URL with the key read from the environment", () => {
    const config = JSON.parse(claudeMcpConfig("https://mcp.example.com/mcp/"));
    expect(config).toEqual({
      mcpServers: {
        pluto: {
          type: "http",
          url: "https://mcp.example.com/mcp/",
          headers: { Authorization: `Bearer \${${API_KEY_ENV}}` },
        },
      },
    });
  });

  it("never embeds a literal key (argv is visible to other local users)", () => {
    process.env[API_KEY_ENV] = "mlpi_secret";
    try {
      expect(claudeMcpConfig(DEFAULT_MCP_URL)).not.toContain("mlpi_secret");
    } finally {
      delete process.env[API_KEY_ENV];
    }
  });
});

describe("codexMcpOverrides", () => {
  it("configures the pluto server with only the granted tools", () => {
    expect(
      codexMcpOverrides("https://mcp.example.com/mcp/", ["list_runs", "get_run"]),
    ).toEqual([
      "-c",
      'mcp_servers.pluto.url="https://mcp.example.com/mcp/"',
      "-c",
      `mcp_servers.pluto.bearer_token_env_var="${API_KEY_ENV}"`,
      "-c",
      'mcp_servers.pluto.enabled_tools=["list_runs","get_run"]',
      "-c",
      'mcp_servers.pluto.default_tools_approval_mode="approve"',
    ]);
  });
});

describe("probeMcp", () => {
  let server: Server | undefined;
  afterEach(
    () => new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve())),
  );

  function serve(status: number): Promise<{ url: string; auth: string[] }> {
    const auth: string[] = [];
    server = createServer((request, response) => {
      auth.push(request.headers.authorization ?? "");
      request.resume();
      request.on("end", () => {
        response.writeHead(status, { "content-type": "application/json" });
        response.end("{}");
      });
    });
    return new Promise((resolve) => {
      server!.listen(0, "127.0.0.1", () => {
        const { port } = server!.address() as AddressInfo;
        resolve({ url: `http://127.0.0.1:${port}/mcp/`, auth });
      });
    });
  }

  it("reports ok when the MCP accepts the key", async () => {
    const { url, auth } = await serve(200);
    expect(await probeMcp(url, "mlpi_good")).toEqual({ status: "ok" });
    expect(auth).toEqual(["Bearer mlpi_good"]);
  });

  it("reports unauthorized on 401 and 403", async () => {
    const { url } = await serve(401);
    expect(await probeMcp(url, "mlpi_bad")).toEqual({ status: "unauthorized" });
    await new Promise<void>((resolve) => server!.close(() => resolve()));
    const forbidden = await serve(403);
    expect(await probeMcp(forbidden.url, "mlpi_bad")).toEqual({
      status: "unauthorized",
    });
  });

  it("reports unreachable with the reason for other failures", async () => {
    const { url } = await serve(502);
    expect(await probeMcp(url, "k")).toEqual({
      status: "unreachable",
      reason: "HTTP 502",
    });
    const refused = await probeMcp("http://127.0.0.1:1/mcp/", "k");
    expect(refused.status).toBe("unreachable");
  });
});
