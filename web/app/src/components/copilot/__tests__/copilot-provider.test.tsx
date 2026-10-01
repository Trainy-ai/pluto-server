/**
 * The provider wraps every authed page, so anything it does on mount must
 * work in an insecure context too: the app is served over plain http in CI
 * (http://app:3000), where `crypto.randomUUID` does not exist. A throw here
 * blanks the whole app, not just the copilot.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { ReactNode } from "react";

import { CopilotProvider, useCopilotActions, useCopilotState } from "../copilot-provider";

function wrapper({ children }: { children: ReactNode }) {
  return <CopilotProvider>{children}</CopilotProvider>;
}

function useCopilot() {
  return { state: useCopilotState()!, actions: useCopilotActions()! };
}

describe("CopilotProvider", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("mounts and starts new conversations without crypto.randomUUID", () => {
    vi.stubGlobal("crypto", { getRandomValues: crypto.getRandomValues.bind(crypto) });

    const { result } = renderHook(useCopilot, { wrapper });
    const first = result.current.state.chat.id;
    expect(first).toBeTruthy();

    act(() => result.current.actions.newConversation());
    expect(result.current.state.chat.id).not.toBe(first);
  });

  it("keeps the same conversation across page-context changes", () => {
    const { result } = renderHook(useCopilot, { wrapper });
    const chatId = result.current.state.chat.id;

    act(() =>
      result.current.actions.publishPageContext({ page: "project", projectName: "p", runs: [] }),
    );
    act(() => result.current.actions.publishPageContext(null));
    expect(result.current.state.chat.id).toBe(chatId);
  });

  it("stops the replaced conversation so its stream does not run on unobserved", () => {
    const { result } = renderHook(useCopilot, { wrapper });
    const previous = result.current.state.chat;
    const stop = vi.spyOn(previous, "stop");

    act(() => result.current.actions.newConversation());
    expect(stop).toHaveBeenCalledTimes(1);

    const backendSwitch = vi.spyOn(result.current.state.chat, "stop");
    act(() => result.current.actions.setModeChoice("local"));
    expect(backendSwitch).toHaveBeenCalledTimes(1);
  });
});
