/**
 * A transient config failure must not flip the chat mode.
 *
 * `mode` falls back to `serverEnabled` until the user picks a backend, and
 * `ChatWorkspace` is keyed on `mode` — so overwriting a good config with
 * `{enabled: false}` remounts the workspace and discards the in-memory
 * conversation. A missing route is durable and may be cached; a 5xx or a
 * dropped connection is not.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { useChatConfig } from "../chat-api";

let client: QueryClient;

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function mockFetch(...responses: Array<Partial<Response> | Error>) {
  const fn = vi.fn();
  for (const r of responses) {
    if (r instanceof Error) fn.mockRejectedValueOnce(r);
    else fn.mockResolvedValueOnce(r as Response);
  }
  vi.stubGlobal("fetch", fn);
  return fn;
}

const ok = (enabled: boolean) =>
  ({
    ok: true,
    status: 200,
    json: async () => ({ enabled }),
  }) as Partial<Response>;

beforeEach(() => {
  client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchOnWindowFocus: false, gcTime: 0 },
    },
  });
  vi.unstubAllGlobals();
});

describe("useChatConfig", () => {
  it("reports enabled when the server says so", async () => {
    mockFetch(ok(true));

    const { result } = renderHook(() => useChatConfig("org_1"), { wrapper });

    await waitFor(() => expect(result.current.data).toEqual({ enabled: true }));
  });

  it("treats a missing chat route as durably disabled", async () => {
    // Older deploys and previews have no /api/chat at all. That is a fact
    // about the deployment, not a blip — local-agent mode is the answer.
    mockFetch({ ok: false, status: 404 } as Partial<Response>);

    const { result } = renderHook(() => useChatConfig("org_1"), { wrapper });

    await waitFor(() =>
      expect(result.current.data).toEqual({ enabled: false }),
    );
    expect(result.current.isError).toBe(false);
  });

  it("keeps the last good config when a refetch 500s", async () => {
    const fetchMock = mockFetch(ok(true), {
      ok: false,
      status: 500,
    } as Partial<Response>);

    const { result } = renderHook(() => useChatConfig("org_1"), { wrapper });
    await waitFor(() => expect(result.current.data).toEqual({ enabled: true }));

    await client.refetchQueries({ queryKey: ["chat-config"] });

    // The refetch really happened, and did not overwrite the good value with
    // {enabled:false} — which would flip `mode` and remount the workspace.
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.current.data).toEqual({ enabled: true });
  });

  it("keeps the last good config when a refetch throws", async () => {
    mockFetch(ok(true), new Error("network down"));

    const { result } = renderHook(() => useChatConfig("org_1"), { wrapper });
    await waitFor(() => expect(result.current.data).toEqual({ enabled: true }));

    await client.refetchQueries({ queryKey: ["chat-config"] });

    expect(result.current.data).toEqual({ enabled: true });
  });
});
