import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useRefreshTime } from "../use-refresh-time";

// IndexedDB-backed timestamp store — mocked so tests don't open a real DB.
vi.mock("@/lib/db/refresh-time", () => ({
  getLastRefreshTime: vi.fn().mockResolvedValue(null),
  setLastRefreshTime: vi.fn().mockResolvedValue(undefined),
}));

describe("useRefreshTime — handler-only contract", () => {
  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does NOT auto-fire onRefresh on mount (RefreshButton owns polling)", async () => {
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    renderHook(() => useRefreshTime({ runId: "TEST-1", onRefresh }));
    // Let any post-mount effects flush.
    await new Promise((r) => setTimeout(r, 30));
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it("invokes onRefresh exactly once when handleRefresh is called manually", async () => {
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useRefreshTime({ runId: "TEST-1", onRefresh }),
    );
    await act(async () => {
      await result.current.handleRefresh();
    });
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it("guards against re-entrancy (concurrent handleRefresh calls)", async () => {
    let resolveOnRefresh: () => void = () => {};
    const onRefresh = vi.fn().mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveOnRefresh = resolve;
        }),
    );
    const { result } = renderHook(() =>
      useRefreshTime({ runId: "TEST-1", onRefresh }),
    );
    act(() => {
      void result.current.handleRefresh();
    });
    await waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(1));
    await act(async () => {
      await result.current.handleRefresh();
      await result.current.handleRefresh();
    });
    expect(onRefresh).toHaveBeenCalledTimes(1);
    await act(async () => {
      resolveOnRefresh();
    });
  });

  it("updates lastRefreshTime after a successful refresh", async () => {
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useRefreshTime({ runId: "TEST-1", onRefresh }),
    );
    expect(result.current.lastRefreshTime).toBeNull();
    await act(async () => {
      await result.current.handleRefresh();
    });
    expect(result.current.lastRefreshTime).toBeInstanceOf(Date);
  });

  it("works with no onRefresh — handleRefresh still updates timestamp", async () => {
    const { result } = renderHook(() => useRefreshTime({ runId: "TEST-1" }));
    await act(async () => {
      await result.current.handleRefresh();
    });
    expect(result.current.lastRefreshTime).toBeInstanceOf(Date);
  });
});
