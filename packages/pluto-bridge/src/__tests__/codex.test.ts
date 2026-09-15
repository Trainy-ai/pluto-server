import { describe, expect, it } from "vitest";
import { buildCodexArgs, parseCodexLine } from "../agents/codex.js";
import { codexMcpOverrides } from "../mcp.js";
import { READ_TOOLS, WRITE_TOOLS } from "../tool-policy.js";

describe("buildCodexArgs", () => {
  const URL = "https://mcp.example.com/mcp/";
  const isolation = [
    "--json",
    "--ignore-user-config",
    "--skip-git-repo-check",
    "-c",
    'sandbox_mode="read-only"',
  ];

  it("starts a fresh exec turn isolated from user config, with read tools only", () => {
    expect(
      buildCodexArgs({ prompt: "hello", systemPrompt: "ctx", mcpUrl: URL }),
    ).toEqual([
      "exec",
      ...isolation,
      ...codexMcpOverrides(URL, [...READ_TOOLS]),
      "ctx\n\nhello",
    ]);
  });

  it("resumes a known thread with the same isolation", () => {
    expect(
      buildCodexArgs({
        prompt: "next question",
        systemPrompt: "ctx",
        resumeSessionId: "thread-1",
        mcpUrl: URL,
      }),
    ).toEqual([
      "exec",
      "resume",
      "thread-1",
      ...isolation,
      ...codexMcpOverrides(URL, [...READ_TOOLS]),
      "next question",
    ]);
  });

  it("enables the write tools only with allowWrites", () => {
    const readOnly = buildCodexArgs({ prompt: "p", systemPrompt: "s", mcpUrl: URL });
    const writable = buildCodexArgs({
      prompt: "p",
      systemPrompt: "s",
      mcpUrl: URL,
      allowWrites: true,
    });
    const enabled = (args: string[]) =>
      args.find((arg) => arg.startsWith("mcp_servers.pluto.enabled_tools="));
    for (const tool of WRITE_TOOLS) {
      expect(enabled(readOnly)).not.toContain(`"${tool}"`);
      expect(enabled(writable)).toContain(`"${tool}"`);
    }
    // Pluto writes are MCP calls; shell commands stay read-only regardless.
    expect(writable).toContain('sandbox_mode="read-only"');
  });
});

describe("parseCodexLine", () => {
  it("extracts the thread id", () => {
    expect(
      parseCodexLine(JSON.stringify({ type: "thread.started", thread_id: "t1" })),
    ).toEqual([{ type: "session", sessionId: "t1" }]);
  });

  it("emits agent message text from completed items", () => {
    const line = JSON.stringify({
      type: "item.completed",
      item: { type: "agent_message", text: "the answer" },
    });
    expect(parseCodexLine(line)).toEqual([{ type: "text", text: "the answer" }]);
  });

  it("supports the legacy msg envelope", () => {
    expect(
      parseCodexLine(JSON.stringify({ msg: { type: "agent_message", message: "hi" } })),
    ).toEqual([{ type: "text", text: "hi" }]);
    expect(
      parseCodexLine(JSON.stringify({ msg: { type: "task_complete" } })),
    ).toEqual([{ type: "done", isError: false }]);
  });

  it("maps turn completion and errors", () => {
    expect(parseCodexLine(JSON.stringify({ type: "turn.completed" }))).toEqual([
      { type: "done", isError: false },
    ]);
    expect(
      parseCodexLine(JSON.stringify({ type: "error", message: "boom" })),
    ).toEqual([{ type: "done", isError: true, errorText: "boom" }]);
  });

  it("ignores noise", () => {
    expect(parseCodexLine("not json")).toEqual([]);
    expect(parseCodexLine(JSON.stringify({ type: "turn.started" }))).toEqual([]);
  });
});
