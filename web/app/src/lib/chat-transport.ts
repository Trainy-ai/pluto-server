import { DefaultChatTransport } from "ai";
import type { ChatMessage, ChatMode } from "@/components/chat/chat-types";
import { getChatApiUrl } from "@/lib/chat-api";
import {
  getLocalBridgeUrl,
  type LocalBridgeSettings,
} from "@/lib/local-bridge";

export interface ChatTransportOptions {
  mode: ChatMode;
  bridgeSettings: LocalBridgeSettings | null;
  organizationId: string;
  orgSlug: string;
  projectName: string;
  /**
   * Rewrites the outgoing messages just before they are sent. Receives the
   * per-request `body` passed to `sendMessage(…, { body })`, so a caller can
   * attach request-scoped data (e.g. what the user is looking at) without it
   * ever entering the visible transcript.
   */
  transformMessages?: (
    messages: WireMessage[],
    requestBody: Record<string, unknown> | undefined,
  ) => WireMessage[];
}

export interface WireMessage {
  id: string;
  role: ChatMessage["role"];
  parts: { type: "text"; text: string }[];
}

/**
 * Turns with no text are dropped. Stop, and a generation that fails before
 * its first token, both leave an assistant turn behind with no text parts —
 * and sanitizeChatMessages rejects any empty message, so forwarding one
 * bricks the thread: every later send 400s until the user starts a New chat.
 */
export function textOnlyMessages(messages: ChatMessage[]): WireMessage[] {
  return messages
    .map((message) => ({
      id: message.id,
      role: message.role,
      parts: message.parts
        .filter(
          (part): part is Extract<typeof part, { type: "text" }> =>
            part.type === "text",
        )
        .map((part) => ({ type: "text" as const, text: part.text })),
    }))
    .filter((message) =>
      message.parts.some((part) => part.text.trim().length > 0),
    );
}

export function createChatTransport({
  mode,
  bridgeSettings,
  organizationId,
  orgSlug,
  projectName,
  transformMessages = (messages) => messages,
}: ChatTransportOptions): DefaultChatTransport<ChatMessage> {
  const bridgePort = bridgeSettings?.port;
  const bridgeToken = bridgeSettings?.token;
  if (mode === "local" && bridgePort && bridgeToken) {
    // The user's own loopback bridge (Claude Code / Codex) answers; it
    // pulls data itself through the pluto MCP server.
    return new DefaultChatTransport<ChatMessage>({
      api: getLocalBridgeUrl(bridgePort, "/chat"),
      headers: { "x-bridge-token": bridgeToken },
      prepareSendMessagesRequest: ({ id, messages, body }) => ({
        body: {
          orgSlug,
          projectName,
          conversationId: id,
          messages: transformMessages(textOnlyMessages(messages), body),
        },
      }),
    });
  }
  return new DefaultChatTransport<ChatMessage>({
    api: getChatApiUrl(),
    credentials: "include",
    prepareSendMessagesRequest: ({ id, messages, body }) => ({
      body: {
        organizationId,
        projectName,
        conversationId: id,
        messages: transformMessages(textOnlyMessages(messages), body),
      },
    }),
  });
}
