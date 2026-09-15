/**
 * Minimal encoder for the AI SDK UI message stream (SSE) protocol, the wire
 * format `DefaultChatTransport` consumes. Kept dependency-free so the bridge
 * ships as a plain Node CLI.
 */

export type UiChunk =
  | { type: "start" }
  | { type: "text-start"; id: string }
  | { type: "text-delta"; id: string; delta: string }
  | { type: "text-end"; id: string }
  | { type: "finish" }
  | { type: "error"; errorText: string };

export const UI_STREAM_HEADERS: Record<string, string> = {
  "content-type": "text/event-stream; charset=utf-8",
  "cache-control": "no-cache, no-transform",
  connection: "keep-alive",
  "x-vercel-ai-ui-message-stream": "v1",
  "x-accel-buffering": "no",
};

export const DONE_EVENT = "data: [DONE]\n\n";

export function encodeUiChunk(chunk: UiChunk): string {
  return `data: ${JSON.stringify(chunk)}\n\n`;
}
