import policy from "./tool-policy.json" with { type: "json" };

/** MCP server name the bridge registers; Claude tool ids are mcp__pluto__<tool>. */
export const PLUTO_MCP_SERVER = policy.server;

/**
 * An explicit allowlist, not a denylist: a write tool added to the MCP later
 * stays ungranted until someone lists it here. mcp/tests/test_bridge_tool_policy.py
 * fails when the MCP registers a tool on neither list.
 */
export const READ_TOOLS: readonly string[] = policy.read;
export const WRITE_TOOLS: readonly string[] = policy.write;

export function grantedTools(allowWrites: boolean): string[] {
  return allowWrites ? [...READ_TOOLS, ...WRITE_TOOLS] : [...READ_TOOLS];
}

export function withheldTools(allowWrites: boolean): string[] {
  return allowWrites ? [] : [...WRITE_TOOLS];
}
