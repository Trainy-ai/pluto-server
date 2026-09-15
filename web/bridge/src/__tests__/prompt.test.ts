import { describe, expect, it } from "vitest";
import { buildSystemPrompt, buildTurnPrompt } from "../prompt";

describe("buildSystemPrompt", () => {
  it("names the org and project and asks for run citations", () => {
    const prompt = buildSystemPrompt({ orgSlug: "dev-org", projectName: "mnist" });
    expect(prompt).toContain("dev-org");
    expect(prompt).toContain("mnist");
    expect(prompt).toContain("[run:");
    expect(prompt.toLowerCase()).toContain("read-only");
  });
});

describe("buildTurnPrompt", () => {
  const history = [
    { role: "user" as const, text: "first question" },
    { role: "assistant" as const, text: "first answer" },
    { role: "user" as const, text: "follow-up" },
  ];

  it("sends only the latest user text when the agent session is resumable", () => {
    expect(buildTurnPrompt(history, true)).toBe("follow-up");
  });

  it("replays prior turns when there is no session to resume", () => {
    const prompt = buildTurnPrompt(history, false);
    expect(prompt).toContain("first question");
    expect(prompt).toContain("first answer");
    expect(prompt.endsWith("follow-up")).toBe(true);
  });

  it("sends a single first message as-is", () => {
    expect(buildTurnPrompt([{ role: "user", text: "hi" }], false)).toBe("hi");
  });

  it("throws when there is no user message", () => {
    expect(() => buildTurnPrompt([], false)).toThrow();
    expect(() =>
      buildTurnPrompt([{ role: "assistant", text: "x" }], false),
    ).toThrow();
  });
});
