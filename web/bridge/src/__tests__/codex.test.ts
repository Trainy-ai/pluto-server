import { describe, expect, it } from "vitest";
import { buildCodexArgs, parseCodexLine } from "../agents/codex";

describe("buildCodexArgs", () => {
  it("starts a fresh exec turn with JSON output", () => {
    expect(
      buildCodexArgs({ prompt: "hello", systemPrompt: "ctx" }),
    ).toEqual(["exec", "--json", "ctx\n\nhello"]);
  });

  it("resumes a known thread", () => {
    expect(
      buildCodexArgs({
        prompt: "next question",
        systemPrompt: "ctx",
        resumeSessionId: "thread-1",
      }),
    ).toEqual(["exec", "resume", "thread-1", "--json", "next question"]);
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
