import { describe, it, expect } from "vitest";
import {
  createBridgeToken,
  isPanelToParentMessage,
  isPanelToParentMessageForToken,
  isParentToPanelMessage,
  type PanelContext,
} from "../panel-bridge-protocol";

const TOKEN = "11111111-2222-3333-4444-555555555555";

const context: PanelContext = {
  projectName: "my-ml-project",
  orgSlug: "dev-org",
  organizationId: "org_123",
  theme: "dark",
  runs: [{ id: "abc123", name: "run-1", color: "#ff0000" }],
  panel: { width: 640, height: 480 },
};

describe("panel-bridge-protocol: iframe → parent guards", () => {
  it("accepts a valid ready message", () => {
    expect(
      isPanelToParentMessage({ mlop: 1, token: TOKEN, type: "ready" }),
    ).toBe(true);
  });

  it("accepts a valid rpc message with string or number id", () => {
    expect(
      isPanelToParentMessage({
        mlop: 1,
        token: TOKEN,
        type: "rpc",
        id: "req-1",
        method: "getMetrics",
        params: { metrics: ["train/loss"] },
      }),
    ).toBe(true);
    expect(
      isPanelToParentMessage({
        mlop: 1,
        token: TOKEN,
        type: "rpc",
        id: 7,
        method: "getRuns",
      }),
    ).toBe(true);
  });

  it("accepts a valid status message for every phase", () => {
    for (const phase of [
      "loading-runtime",
      "installing",
      "running",
      "done",
      "error",
    ]) {
      expect(
        isPanelToParentMessage({
          mlop: 1,
          token: TOKEN,
          type: "status",
          phase,
          detail: "x",
        }),
      ).toBe(true);
    }
  });

  it("rejects non-objects and null", () => {
    expect(isPanelToParentMessage(null)).toBe(false);
    expect(isPanelToParentMessage(undefined)).toBe(false);
    expect(isPanelToParentMessage("ready")).toBe(false);
    expect(isPanelToParentMessage(42)).toBe(false);
  });

  it("rejects wrong or missing protocol version", () => {
    expect(isPanelToParentMessage({ token: TOKEN, type: "ready" })).toBe(false);
    expect(
      isPanelToParentMessage({ mlop: 2, token: TOKEN, type: "ready" }),
    ).toBe(false);
    expect(
      isPanelToParentMessage({ mlop: "1", token: TOKEN, type: "ready" }),
    ).toBe(false);
  });

  it("rejects missing, empty, or non-string token", () => {
    expect(isPanelToParentMessage({ mlop: 1, type: "ready" })).toBe(false);
    expect(isPanelToParentMessage({ mlop: 1, token: "", type: "ready" })).toBe(
      false,
    );
    expect(
      isPanelToParentMessage({ mlop: 1, token: 123, type: "ready" }),
    ).toBe(false);
    expect(
      isPanelToParentMessage({ mlop: 1, token: null, type: "ready" }),
    ).toBe(false);
  });

  it("rejects unknown message types and unknown phases", () => {
    expect(
      isPanelToParentMessage({ mlop: 1, token: TOKEN, type: "evil" }),
    ).toBe(false);
    expect(
      isPanelToParentMessage({
        mlop: 1,
        token: TOKEN,
        type: "status",
        phase: "exfiltrating",
      }),
    ).toBe(false);
  });

  it("rejects rpc messages missing id or method", () => {
    expect(
      isPanelToParentMessage({ mlop: 1, token: TOKEN, type: "rpc", id: "1" }),
    ).toBe(false);
    expect(
      isPanelToParentMessage({
        mlop: 1,
        token: TOKEN,
        type: "rpc",
        method: "getRuns",
      }),
    ).toBe(false);
  });

  it("rejects non-integer and non-finite numeric rpc ids", () => {
    for (const id of [1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(
        isPanelToParentMessage({
          mlop: 1,
          token: TOKEN,
          type: "rpc",
          id,
          method: "getRuns",
          params: {},
        }),
      ).toBe(false);
    }
  });

  it("rejects extra keys (strict envelopes)", () => {
    expect(
      isPanelToParentMessage({
        mlop: 1,
        token: TOKEN,
        type: "ready",
        __proto__pollution: true,
      }),
    ).toBe(false);
  });

  it("token-scoped guard drops messages with a different token", () => {
    const msg = { mlop: 1, token: TOKEN, type: "ready" };
    expect(isPanelToParentMessageForToken(msg, TOKEN)).toBe(true);
    expect(isPanelToParentMessageForToken(msg, "other-token")).toBe(false);
    expect(isPanelToParentMessageForToken(null, TOKEN)).toBe(false);
  });
});

describe("panel-bridge-protocol: parent → iframe guards", () => {
  it("accepts a valid init message", () => {
    expect(
      isParentToPanelMessage({
        mlop: 1,
        type: "init",
        token: TOKEN,
        code: "import streamlit as st",
        requirements: ["seaborn"],
        sdk: "# mlop sdk source",
        context,
      }),
    ).toBe(true);
  });

  it("rejects init with malformed context", () => {
    expect(
      isParentToPanelMessage({
        mlop: 1,
        type: "init",
        token: TOKEN,
        code: "x",
        requirements: [],
        sdk: "# mlop sdk source",
        context: { ...context, theme: "solarized" },
      }),
    ).toBe(false);
  });

  it("accepts ok and error rpc-result variants", () => {
    expect(
      isParentToPanelMessage({
        mlop: 1,
        type: "rpc-result",
        id: "req-1",
        ok: true,
        data: { rows: [] },
      }),
    ).toBe(true);
    expect(
      isParentToPanelMessage({
        mlop: 1,
        type: "rpc-result",
        id: "req-1",
        ok: false,
        error: { code: "BAD_PARAMS", message: "nope" },
      }),
    ).toBe(true);
  });

  it("rejects rpc-result with unknown error code or mismatched ok/payload", () => {
    expect(
      isParentToPanelMessage({
        mlop: 1,
        type: "rpc-result",
        id: "req-1",
        ok: false,
        error: { code: "SOMETHING_ELSE", message: "nope" },
      }),
    ).toBe(false);
    expect(
      isParentToPanelMessage({
        mlop: 1,
        type: "rpc-result",
        id: "req-1",
        ok: false,
        data: {},
      }),
    ).toBe(false);
  });

  it("accepts context-update, rerun, and dispose", () => {
    expect(
      isParentToPanelMessage({ mlop: 1, type: "context-update", context }),
    ).toBe(true);
    expect(isParentToPanelMessage({ mlop: 1, type: "rerun" })).toBe(true);
    expect(isParentToPanelMessage({ mlop: 1, type: "dispose" })).toBe(true);
  });

  it("rejects wrong version and unknown types", () => {
    expect(isParentToPanelMessage({ mlop: 0, type: "rerun" })).toBe(false);
    expect(isParentToPanelMessage({ mlop: 1, type: "eval" })).toBe(false);
  });
});

describe("createBridgeToken", () => {
  it("returns unique UUID-shaped strings", () => {
    const a = createBridgeToken();
    const b = createBridgeToken();
    expect(a).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(a).not.toBe(b);
  });
});
