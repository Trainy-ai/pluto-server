// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { registerPanelHandler } from "../panel-message-hub";

function dispatch(data: unknown) {
  window.dispatchEvent(new MessageEvent("message", { data }));
}

const readyMessage = (token: string) => ({
  mlop: 1,
  token,
  type: "ready",
});

describe("panel-message-hub", () => {
  it("routes messages to the handler registered for their token", () => {
    const handlerA = vi.fn();
    const handlerB = vi.fn();
    const offA = registerPanelHandler("token-a", handlerA);
    const offB = registerPanelHandler("token-b", handlerB);

    dispatch(readyMessage("token-a"));
    expect(handlerA).toHaveBeenCalledTimes(1);
    expect(handlerA.mock.calls[0][0]).toMatchObject({ type: "ready", token: "token-a" });
    expect(handlerB).not.toHaveBeenCalled();

    dispatch(readyMessage("token-b"));
    expect(handlerB).toHaveBeenCalledTimes(1);

    offA();
    offB();
  });

  it("drops structurally invalid messages even with a registered token", () => {
    const handler = vi.fn();
    const off = registerPanelHandler("token-c", handler);

    dispatch({ mlop: 1, token: "token-c", type: "not-a-real-type" });
    dispatch({ mlop: 2, token: "token-c", type: "ready" }); // wrong version
    dispatch({ mlop: 1, token: "token-c", type: "ready", extra: 1 }); // strict schema
    dispatch("just a string");
    dispatch(null);
    expect(handler).not.toHaveBeenCalled();

    off();
  });

  it("drops messages for unregistered tokens", () => {
    const handler = vi.fn();
    const off = registerPanelHandler("token-d", handler);

    dispatch(readyMessage("someone-elses-token"));
    expect(handler).not.toHaveBeenCalled();

    off();
  });

  it("stops routing after unregister", () => {
    const handler = vi.fn();
    const off = registerPanelHandler("token-e", handler);
    dispatch(readyMessage("token-e"));
    expect(handler).toHaveBeenCalledTimes(1);

    off();
    dispatch(readyMessage("token-e"));
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("routes rpc messages with id/method/params intact", () => {
    const handler = vi.fn();
    const off = registerPanelHandler("token-f", handler);

    dispatch({
      mlop: 1,
      token: "token-f",
      type: "rpc",
      id: "r1",
      method: "getMetrics",
      params: { metrics: ["train/loss"] },
    });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0]).toMatchObject({
      type: "rpc",
      id: "r1",
      method: "getMetrics",
      params: { metrics: ["train/loss"] },
    });

    off();
  });
});
