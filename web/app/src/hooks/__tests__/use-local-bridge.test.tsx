/**
 * A health probe must not be able to destroy a conversation.
 *
 * `probeLocalBridge` resolves `{ ok: false }` on timeouts and network errors
 * rather than throwing, and the query runs every 15s with `retry: false`. So a
 * single blip — the laptop sleeping, the bridge briefly busy, a 2s timeout
 * under load — flips `isConnected` to false. The chat route uses that flag to
 * decide whether to mount `ChatWorkspace`, and the messages live inside it via
 * `useChat`, so unmounting discards them. Chat history is in-memory only, so
 * they are unrecoverable.
 *
 * `hasConnected` is the fix: sticky per settings, so a dropped bridge becomes a
 * banner rather than an unmount.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const probeLocalBridge = vi.fn();

vi.mock("@/lib/local-bridge", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/local-bridge")>(
      "@/lib/local-bridge",
    );
  return {
    ...actual,
    probeLocalBridge: (...args: unknown[]) => probeLocalBridge(...args),
  };
});

import { useLocalBridge } from "../use-local-bridge";
import { LOCAL_BRIDGE_STORAGE_KEY } from "@/lib/local-bridge";

let client: QueryClient;

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchInterval: false, gcTime: 0 },
    },
  });
  probeLocalBridge.mockReset();
  localStorage.setItem(
    LOCAL_BRIDGE_STORAGE_KEY,
    JSON.stringify({ port: 8377, token: "t" }),
  );
});

afterEach(() => localStorage.clear());

describe("useLocalBridge", () => {
  it("reports connected after a successful probe", async () => {
    probeLocalBridge.mockResolvedValue({ ok: true, agent: "claude" });

    const { result } = renderHook(() => useLocalBridge(), { wrapper });

    await waitFor(() => expect(result.current.isConnected).toBe(true));
    expect(result.current.agentName).toBe("claude");
    expect(result.current.hasConnected).toBe(true);
  });

  it("keeps hasConnected true when a later probe fails", async () => {
    probeLocalBridge.mockResolvedValueOnce({ ok: true, agent: "claude" });

    const { result } = renderHook(() => useLocalBridge(), { wrapper });
    await waitFor(() => expect(result.current.isConnected).toBe(true));

    probeLocalBridge.mockResolvedValue({ ok: false });
    await act(async () => {
      await client.invalidateQueries({ queryKey: ["local-bridge-status"] });
    });

    await waitFor(() => expect(result.current.isConnected).toBe(false));
    // The conversation must survive: the route keys mounting off hasConnected.
    expect(result.current.hasConnected).toBe(true);
  });

  it("never sets hasConnected when the bridge was never reachable", async () => {
    probeLocalBridge.mockResolvedValue({ ok: false });

    const { result } = renderHook(() => useLocalBridge(), { wrapper });

    await waitFor(() => expect(result.current.isProbing).toBe(false));
    expect(result.current.hasConnected).toBe(false);
  });

  it("clears hasConnected when the user pairs a different bridge", async () => {
    probeLocalBridge.mockResolvedValue({ ok: true, agent: "claude" });

    const { result } = renderHook(() => useLocalBridge(), { wrapper });
    await waitFor(() => expect(result.current.hasConnected).toBe(true));

    probeLocalBridge.mockResolvedValue({ ok: false });
    act(() => result.current.saveSettings({ port: 9999, token: "other" }));

    // A new pairing is a new bridge — the old success must not vouch for it.
    expect(result.current.hasConnected).toBe(false);
  });

  it("clears hasConnected when the pairing is removed", async () => {
    probeLocalBridge.mockResolvedValue({ ok: true, agent: "claude" });

    const { result } = renderHook(() => useLocalBridge(), { wrapper });
    await waitFor(() => expect(result.current.hasConnected).toBe(true));

    act(() => result.current.saveSettings(null));

    expect(result.current.hasConnected).toBe(false);
  });
});
