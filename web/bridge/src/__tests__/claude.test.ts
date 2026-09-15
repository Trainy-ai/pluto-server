import { describe, expect, it } from "vitest";
import { buildClaudeArgs, parseClaudeLine } from "../agents/claude";

describe("buildClaudeArgs", () => {
  it("builds a first-turn command with system prompt and print streaming", () => {
    const args = buildClaudeArgs({
      systemPrompt: "Project context",
      allowedTools: ["mcp__pluto"],
    });
    expect(args).toEqual([
      "-p",
      "--output-format",
      "stream-json",
      "--verbose",
      "--append-system-prompt",
      "Project context",
      "--allowedTools",
      "mcp__pluto",
    ]);
  });

  it("never puts a positional prompt on argv (variadic flags would eat it)", () => {
    const args = buildClaudeArgs({ systemPrompt: "ctx" });
    expect(args[args.length - 1]).toBe("mcp__pluto");
  });

  it("resumes a known session and passes an MCP config when provided", () => {
    const args = buildClaudeArgs({
      systemPrompt: "ctx",
      resumeSessionId: "sess-1",
      mcpConfigPath: "/tmp/mcp.json",
      allowedTools: [],
    });
    expect(args).toContain("--resume");
    expect(args[args.indexOf("--resume") + 1]).toBe("sess-1");
    expect(args[args.indexOf("--mcp-config") + 1]).toBe("/tmp/mcp.json");
    expect(args).not.toContain("--allowedTools");
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
