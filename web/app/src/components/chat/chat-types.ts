import type { UIMessage } from "ai";

export type ChatMessage = UIMessage<{ feedbackToken?: string }>;

export type ChatMode = "server" | "local";

export function messageText(message: ChatMessage): string {
  return message.parts
    .filter(
      (part): part is Extract<typeof part, { type: "text" }> =>
        part.type === "text",
    )
    .map((part) => part.text)
    .join("");
}
