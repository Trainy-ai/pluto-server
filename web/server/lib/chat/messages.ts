import type { UIMessage } from "ai";
import { z } from "zod";

const MAX_MESSAGES = 40;
const MAX_MESSAGE_CHARS = 8_000;
const MAX_CONVERSATION_CHARS = 40_000;

const chatMessageSchema = z.object({
  id: z.string().min(1).max(128),
  role: z.enum(["user", "assistant"]),
  parts: z.array(z.unknown()).max(20),
});

export const chatRequestSchema = z.object({
  organizationId: z.string().min(1),
  projectName: z.string().min(1).max(255),
  conversationId: z.string().min(1).max(128),
  messages: z.array(chatMessageSchema).min(1).max(MAX_MESSAGES),
});

export type ChatRequest = z.infer<typeof chatRequestSchema>;

export function sanitizeChatMessages(messages: ChatRequest["messages"]): {
  messages: UIMessage[];
  turnId: string;
  latestUserText: string;
} {
  let totalCharacters = 0;

  const sanitized = messages.map((message) => {
    if (
      message.parts.some(
        (part) =>
          typeof part !== "object" ||
          part === null ||
          !("type" in part) ||
          part.type !== "text" ||
          !("text" in part) ||
          typeof part.text !== "string",
      )
    ) {
      throw new Error("Chat messages may contain text only");
    }

    const text = message.parts
      .filter(
        (part): part is { type: "text"; text: string } =>
          typeof part === "object" &&
          part !== null &&
          "type" in part &&
          part.type === "text" &&
          "text" in part &&
          typeof part.text === "string",
      )
      .map((part) => part.text)
      .join("")
      .trim();

    if (!text || text.length > MAX_MESSAGE_CHARS) {
      throw new Error("Each chat message must contain 1-8000 text characters");
    }

    totalCharacters += text.length;
    return {
      id: message.id,
      role: message.role,
      parts: [{ type: "text" as const, text }],
    } satisfies UIMessage;
  });

  if (totalCharacters > MAX_CONVERSATION_CHARS) {
    throw new Error("The conversation is too large; start a new chat");
  }

  const latestUserMessage = [...sanitized]
    .reverse()
    .find((message) => message.role === "user");

  if (!latestUserMessage || sanitized.at(-1)?.role !== "user") {
    throw new Error("The final chat message must be from the user");
  }

  return {
    messages: sanitized,
    turnId: latestUserMessage.id,
    latestUserText: latestUserMessage.parts[0].text,
  };
}
