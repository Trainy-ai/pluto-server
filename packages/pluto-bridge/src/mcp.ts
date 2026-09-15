import { PLUTO_MCP_SERVER } from "./tool-policy.js";

export const DEFAULT_MCP_URL = "https://pluto-mcp.trainy.ai/mcp/";
export const API_KEY_ENV = "PLUTO_API_KEY";

const PROBE_TIMEOUT_MS = 10_000;

/**
 * Claude Code MCP config for the pluto server. The key is referenced as
 * `${PLUTO_API_KEY}` and expanded by Claude Code, so it never appears on the
 * child's argv, where other local users could read it.
 */
export function claudeMcpConfig(url: string): string {
  return JSON.stringify({
    mcpServers: {
      [PLUTO_MCP_SERVER]: {
        type: "http",
        url,
        headers: { Authorization: `Bearer \${${API_KEY_ENV}}` },
      },
    },
  });
}

/** Codex `-c` overrides that register the pluto server with only `tools` enabled. */
export function codexMcpOverrides(url: string, tools: string[]): string[] {
  const key = `mcp_servers.${PLUTO_MCP_SERVER}`;
  return [
    `${key}.url=${JSON.stringify(url)}`,
    `${key}.bearer_token_env_var=${JSON.stringify(API_KEY_ENV)}`,
    `${key}.enabled_tools=${JSON.stringify(tools)}`,
    // codex exec cannot prompt, and enabled_tools already bounds what runs.
    `${key}.default_tools_approval_mode="approve"`,
  ].flatMap((override) => ["-c", override]);
}

export type McpProbeResult =
  | { status: "ok" }
  | { status: "unauthorized" }
  | { status: "unreachable"; reason: string };

/**
 * Send an MCP `initialize` with the API key so a bad or missing credential
 * fails at startup instead of mid-way through someone's first chat turn.
 */
export async function probeMcp(
  url: string,
  apiKey: string,
): Promise<McpProbeResult> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 0,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "pluto-bridge", version: "probe" },
        },
      }),
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
  } catch (error) {
    return {
      status: "unreachable",
      reason: error instanceof Error ? error.message : String(error),
    };
  }
  await response.body?.cancel();
  if (response.status === 401 || response.status === 403) {
    return { status: "unauthorized" };
  }
  if (!response.ok) {
    return { status: "unreachable", reason: `HTTP ${response.status}` };
  }
  return { status: "ok" };
}
