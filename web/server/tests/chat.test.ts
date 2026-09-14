import { describe, expect, it } from "vitest";
import { redactSensitiveData } from "../lib/chat/context";
import { chatRequestSchema, sanitizeChatMessages } from "../lib/chat/messages";
import {
  createChatFeedbackToken,
  verifyChatFeedbackToken,
} from "../lib/chat/feedback-token";

describe("chat message validation", () => {
  it("normalizes text parts and returns the latest user turn", () => {
    const result = sanitizeChatMessages([
      { id: "u1", role: "user", parts: [{ type: "text", text: " hello " }] },
      {
        id: "a1",
        role: "assistant",
        parts: [{ type: "text", text: "hi" }],
      },
      { id: "u2", role: "user", parts: [{ type: "text", text: "compare" }] },
    ]);

    expect(result.turnId).toBe("u2");
    expect(result.latestUserText).toBe("compare");
    expect(result.messages[1].parts).toEqual([{ type: "text", text: "hi" }]);
  });

  it("rejects non-text parts", () => {
    expect(() =>
      sanitizeChatMessages([
        {
          id: "u1",
          role: "user",
          parts: [
            { type: "text", text: "hello" },
            { type: "source-url", url: "https://example.com" },
          ],
        },
      ]),
    ).toThrow("text only");
  });

  it("rejects a history that does not end with a user turn", () => {
    expect(() =>
      sanitizeChatMessages([
        { id: "a1", role: "assistant", parts: [{ type: "text", text: "hi" }] },
      ]),
    ).toThrow("final chat message");
  });

  it("enforces per-message and total conversation limits", () => {
    expect(() =>
      sanitizeChatMessages([
        {
          id: "u1",
          role: "user",
          parts: [{ type: "text", text: "x".repeat(8_001) }],
        },
      ]),
    ).toThrow("1-8000");

    expect(() =>
      sanitizeChatMessages(
        Array.from({ length: 7 }, (_, index) => ({
          id: `u${index}`,
          role: "user" as const,
          parts: [{ type: "text", text: "x".repeat(6_000) }],
        })),
      ),
    ).toThrow("conversation is too large");
  });

  it("enforces message and part count limits at the request boundary", () => {
    const message = {
      id: "u1",
      role: "user" as const,
      parts: [{ type: "text", text: "hello" }],
    };
    expect(
      chatRequestSchema.safeParse({
        organizationId: "org",
        projectName: "project",
        conversationId: "chat",
        messages: Array.from({ length: 41 }, () => message),
      }).success,
    ).toBe(false);
    expect(
      chatRequestSchema.safeParse({
        organizationId: "org",
        projectName: "project",
        conversationId: "chat",
        messages: [
          {
            ...message,
            parts: Array.from({ length: 21 }, () => message.parts[0]),
          },
        ],
      }).success,
    ).toBe(false);
  });
});

describe("chat data redaction", () => {
  it("redacts nested secret keys and inline bearer tokens", () => {
    expect(
      redactSensitiveData({
        learningRate: 0.1,
        api_key: "secret-value",
        clientSecret: "another-secret",
        databaseUrl:
          "postgresql://user:password@db.example.com/app?api_key=abc",
        nested: {
          authorization: "Bearer abc123",
          note: "token=xyz",
          refreshToken: "refresh-secret",
        },
      }),
    ).toEqual({
      learningRate: 0.1,
      api_key: "[REDACTED]",
      clientSecret: "[REDACTED]",
      databaseUrl:
        "postgresql://[REDACTED]@db.example.com/app?api_key=[REDACTED]",
      nested: {
        authorization: "[REDACTED]",
        note: "token=[REDACTED]",
        refreshToken: "[REDACTED]",
      },
    });
  });
});

describe("chat feedback capabilities", () => {
  it("accepts signed claims and rejects tampering", () => {
    const claims = {
      organizationId: "org",
      userId: "user",
      projectName: "project",
      conversationId: "conversation",
      turnId: "turn",
      issuedAt: Date.now(),
    };
    const token = createChatFeedbackToken(claims, "test-secret");
    expect(verifyChatFeedbackToken(token, "test-secret")).toEqual(claims);
    expect(
      verifyChatFeedbackToken(`${token}tampered`, "test-secret"),
    ).toBeUndefined();
    const expiredToken = createChatFeedbackToken(
      { ...claims, issuedAt: Date.now() - 25 * 60 * 60 * 1_000 },
      "test-secret",
    );
    expect(
      verifyChatFeedbackToken(expiredToken, "test-secret"),
    ).toBeUndefined();
  });
});
