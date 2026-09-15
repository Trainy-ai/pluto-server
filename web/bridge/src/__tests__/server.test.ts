import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import { createBridgeServer, type BridgeServer } from "../server";
import type { AgentEvent, AgentRunner, AgentTurnOptions } from "../types";

const TOKEN = "test-token";

function fakeRunner(
  events: AgentEvent[],
  seen: AgentTurnOptions[] = [],
): AgentRunner {
  return {
    name: "fake",
    async *runTurn(options) {
      seen.push(options);
      yield* events;
    },
  };
}

function chatBody(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    conversationId: "conv-1",
    orgSlug: "dev-org",
    projectName: "mnist",
    messages: [{ role: "user", text: "how is training going?" }],
    ...overrides,
  });
}

describe("bridge server", () => {
  let bridge: BridgeServer;
  let baseUrl: string;
  let seenTurns: AgentTurnOptions[];

  function start(events?: AgentEvent[]) {
    seenTurns = [];
    bridge = createBridgeServer({
      token: TOKEN,
      runner: fakeRunner(
        events ?? [
          { type: "session", sessionId: "sess-1" },
          { type: "text", text: "All " },
          { type: "text", text: "good." },
          { type: "done", isError: false },
        ],
        seenTurns,
      ),
    });
    return new Promise<void>((resolve) => {
      bridge.server.listen(0, "127.0.0.1", () => {
        const { port } = bridge.server.address() as AddressInfo;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });
  }

  beforeEach(() => start());
  afterEach(() => new Promise<void>((r) => bridge.server.close(() => r())));

  it("rejects requests without the bridge token", async () => {
    const health = await fetch(`${baseUrl}/health`);
    expect(health.status).toBe(401);
    const chat = await fetch(`${baseUrl}/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: chatBody(),
    });
    expect(chat.status).toBe(401);
  });

  it("answers health checks with the agent name", async () => {
    const response = await fetch(`${baseUrl}/health`, {
      headers: { "x-bridge-token": TOKEN },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, agent: "fake" });
  });

  it("answers CORS preflights including private network access", async () => {
    const response = await fetch(`${baseUrl}/chat`, {
      method: "OPTIONS",
      headers: {
        origin: "https://app.example.com",
        "access-control-request-method": "POST",
        "access-control-request-headers": "content-type,x-bridge-token",
        "access-control-request-private-network": "true",
      },
    });
    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe(
      "https://app.example.com",
    );
    expect(
      response.headers.get("access-control-allow-headers")?.toLowerCase(),
    ).toContain("x-bridge-token");
    expect(
      response.headers.get("access-control-allow-private-network"),
    ).toBe("true");
  });

  it("streams a ui message stream for a chat turn", async () => {
    const response = await fetch(`${baseUrl}/chat`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-bridge-token": TOKEN },
      body: chatBody(),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("x-vercel-ai-ui-message-stream")).toBe("v1");
    const raw = await response.text();
    const chunks = raw
      .split("\n\n")
      .filter(Boolean)
      .map((line) => line.replace(/^data: /, ""))
      .map((payload) => (payload === "[DONE]" ? "[DONE]" : JSON.parse(payload)));

    expect(chunks[0]).toEqual({ type: "start" });
    const deltas = chunks.filter(
      (chunk): chunk is { type: string; delta: string } =>
        typeof chunk === "object" && chunk.type === "text-delta",
    );
    expect(deltas.map((delta) => delta.delta).join("")).toBe("All good.");
    expect(chunks).toContainEqual({ type: "finish" });
    expect(chunks[chunks.length - 1]).toBe("[DONE]");
  });

  it("passes project context and resumes the session on the next turn", async () => {
    const first = await fetch(`${baseUrl}/chat`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-bridge-token": TOKEN },
      body: chatBody(),
    });
    await first.text();
    expect(seenTurns[0]?.resumeSessionId).toBeUndefined();
    expect(seenTurns[0]?.systemPrompt).toContain("mnist");

    const second = await fetch(`${baseUrl}/chat`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-bridge-token": TOKEN },
      body: chatBody({
        messages: [
          { role: "user", text: "how is training going?" },
          { role: "assistant", text: "All good." },
          { role: "user", text: "and eval?" },
        ],
      }),
    });
    await second.text();
    expect(seenTurns[1]?.resumeSessionId).toBe("sess-1");
    expect(seenTurns[1]?.prompt).toBe("and eval?");
  });

  it("normalizes ai-sdk style message parts", async () => {
    const response = await fetch(`${baseUrl}/chat`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-bridge-token": TOKEN },
      body: chatBody({
        messages: [
          {
            role: "user",
            parts: [{ type: "text", text: "from parts" }],
          },
        ],
      }),
    });
    expect(response.status).toBe(200);
    await response.text();
    expect(seenTurns[0]?.prompt).toBe("from parts");
  });

  it("rejects malformed chat requests", async () => {
    const response = await fetch(`${baseUrl}/chat`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-bridge-token": TOKEN },
      body: JSON.stringify({ nope: true }),
    });
    expect(response.status).toBe(400);
  });

  it("surfaces agent errors as error chunks", async () => {
    await new Promise<void>((r) => bridge.server.close(() => r()));
    await start([{ type: "done", isError: true, errorText: "agent exploded" }]);
    const response = await fetch(`${baseUrl}/chat`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-bridge-token": TOKEN },
      body: chatBody(),
    });
    const raw = await response.text();
    expect(raw).toContain('"type":"error"');
    expect(raw).toContain("agent exploded");
  });
});
