import { describe, expect, it } from "vitest";
import { encodeUiChunk, DONE_EVENT, UI_STREAM_HEADERS } from "../ui-stream";

describe("ui message stream encoding", () => {
  it("encodes chunks as SSE data lines", () => {
    expect(encodeUiChunk({ type: "start" })).toBe('data: {"type":"start"}\n\n');
    expect(
      encodeUiChunk({ type: "text-delta", id: "p1", delta: "hi" }),
    ).toBe('data: {"type":"text-delta","id":"p1","delta":"hi"}\n\n');
  });

  it("terminates with [DONE]", () => {
    expect(DONE_EVENT).toBe("data: [DONE]\n\n");
  });

  it("advertises the ui message stream protocol", () => {
    expect(UI_STREAM_HEADERS["content-type"]).toContain("text/event-stream");
    expect(UI_STREAM_HEADERS["x-vercel-ai-ui-message-stream"]).toBe("v1");
  });
});
