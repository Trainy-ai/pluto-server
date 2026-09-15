import { describe, expect, it } from "vitest";
import { buildClaudeArgs, parseClaudeLine } from "../agents/claude.js";
import { claudeMcpConfig } from "../mcp.js";
import { READ_TOOLS, WRITE_TOOLS } from "../tool-policy.js";

describe("buildClaudeArgs", () => {
  const MCP = claudeMcpConfig("https://mcp.example.com/mcp/");
  const pluto = (tools: readonly string[]) =>
    tools.map((tool) => `mcp__pluto__${tool}`).join(",");

  it("builds a read-only first turn scoped to the bridge's own MCP config", () => {
    const args = buildClaudeArgs({ systemPrompt: "Project context", mcpConfig: MCP });
    expect(args).toEqual([
      "-p",
      "--output-format",
      "stream-json",
      "--verbose",
      "--append-system-prompt",
      "Project context",
      "--strict-mcp-config",
      "--mcp-config",
      MCP,
      "--allowedTools",
      pluto(READ_TOOLS),
      "--disallowedTools",
      pluto(WRITE_TOOLS),
    ]);
  });

  it("grants no write tool and denies all six by default", () => {
    const args = buildClaudeArgs({ systemPrompt: "ctx", mcpConfig: MCP });
    const allowed = args[args.indexOf("--allowedTools") + 1]!.split(",");
    const denied = args[args.indexOf("--disallowedTools") + 1]!.split(",");
    for (const tool of WRITE_TOOLS) {
      expect(allowed).not.toContain(`mcp__pluto__${tool}`);
      expect(denied).toContain(`mcp__pluto__${tool}`);
    }
    // A bare server prefix would grant every tool on it, writes included.
    expect(allowed).not.toContain("mcp__pluto");
  });

  it("grants the write tools and denies nothing with allowWrites", () => {
    const args = buildClaudeArgs({
      systemPrompt: "ctx",
      mcpConfig: MCP,
      allowWrites: true,
    });
    expect(args[args.indexOf("--allowedTools") + 1]).toBe(
      pluto([...READ_TOOLS, ...WRITE_TOOLS]),
    );
    expect(args).not.toContain("--disallowedTools");
  });

  it("never puts a positional prompt on argv (variadic flags would eat it)", () => {
    const args = buildClaudeArgs({ systemPrompt: "ctx", mcpConfig: MCP });
    expect(args[args.length - 1]).toBe(pluto(WRITE_TOOLS));
  });

  it("resumes a known session", () => {
    const args = buildClaudeArgs({
      systemPrompt: "ctx",
      resumeSessionId: "sess-1",
      mcpConfig: "/tmp/mcp.json",
    });
    expect(args[args.indexOf("--resume") + 1]).toBe("sess-1");
    expect(args[args.indexOf("--mcp-config") + 1]).toBe("/tmp/mcp.json");
  });
});

describe("parseClaudeLine", () => {
  it("extracts the session id from the init event", () => {
    expect(
      parseClaudeLine(
        JSON.stringify({ type: "system", subtype: "init", session_id: "s1" }),
      ),
    ).toEqual([{ type: "session", sessionId: "s1" }]);
  });

  it("emits text for assistant text blocks and skips tool_use blocks", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        content: [
          { type: "text", text: "Looking at the runs. " },
          { type: "tool_use", id: "t1", name: "mcp__pluto__list_runs" },
          { type: "text", text: "One moment." },
        ],
      },
    });
    expect(parseClaudeLine(line)).toEqual([
      { type: "text", text: "Looking at the runs. One moment." },
    ]);
  });

  it("maps a successful result to done without duplicating the answer text", () => {
    const line = JSON.stringify({
      type: "result",
      subtype: "success",
      result: "final answer",
      session_id: "s1",
    });
    expect(parseClaudeLine(line)).toEqual([{ type: "done", isError: false }]);
  });

  it("maps an error result to done with the error text", () => {
    const line = JSON.stringify({
      type: "result",
      subtype: "error_max_turns",
      result: "ran out of turns",
    });
    expect(parseClaudeLine(line)).toEqual([
      { type: "done", isError: true, errorText: "ran out of turns" },
    ]);
  });

  it("ignores unrelated events and unparseable lines", () => {
    expect(parseClaudeLine(JSON.stringify({ type: "user" }))).toEqual([]);
    expect(parseClaudeLine("not json")).toEqual([]);
    expect(parseClaudeLine("")).toEqual([]);
  });
});
