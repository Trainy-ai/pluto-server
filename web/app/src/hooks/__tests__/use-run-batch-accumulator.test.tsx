import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useRunBatchAccumulator } from "../use-run-batch-accumulator";

afterEach(() => cleanup());

interface Val {
  v: string;
}

// Fresh QueryClient per test so caches never leak across tests; retry off so a
// rejected fetch surfaces immediately instead of being retried.
function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  };
}

// One record per requested id, so we can assert exactly which runs were fetched.
function makeFetcher() {
  return vi.fn(async (ids: string[]) =>
    Object.fromEntries(ids.map((id) => [id, { v: id.toUpperCase() }])),
  );
}

describe("useRunBatchAccumulator", () => {
  it("fetches all selected runs in one batch, then only the delta on growth, and never refetches held runs", async () => {
    const fetchMissing = makeFetcher();
    const { result, rerender } = renderHook(
      ({ ids }: { ids: string[] }) =>
        useRunBatchAccumulator<Val>({
          selectedRunIds: ids,
          wipeKey: "k",
          queryKeyBase: ["test"],
          fetchMissing,
        }),
      { wrapper: makeWrapper(), initialProps: { ids: ["a", "b"] } },
    );

    // First render: ONE batched call for all selected runs.
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(fetchMissing).toHaveBeenCalledTimes(1);
    expect(fetchMissing).toHaveBeenCalledWith(["a", "b"]);
    expect(result.current.data).toEqual({ a: { v: "A" }, b: { v: "B" } });

    // Add a run: fetch ONLY the delta ("c"), merge into the kept map.
    rerender({ ids: ["a", "b", "c"] });
    await waitFor(() => expect(result.current.data).toHaveProperty("c"));
    expect(fetchMissing).toHaveBeenCalledTimes(2);
    expect(fetchMissing).toHaveBeenLastCalledWith(["c"]);
    expect(result.current.data).toEqual({
      a: { v: "A" },
      b: { v: "B" },
      c: { v: "C" },
    });

    // Remove a run: ZERO new fetches; selection just narrows.
    rerender({ ids: ["b", "c"] });
    await waitFor(() =>
      expect(result.current.data).toEqual({ b: { v: "B" }, c: { v: "C" } }),
    );
    expect(fetchMissing).toHaveBeenCalledTimes(2);

    // Re-add a previously fetched run: still ZERO new fetches.
    rerender({ ids: ["a", "b", "c"] });
    expect(fetchMissing).toHaveBeenCalledTimes(2);
    expect(result.current.data).toEqual({
      a: { v: "A" },
      b: { v: "B" },
      c: { v: "C" },
    });
  });

  it("records fetched runs even when they return no data, so empties are never re-requested", async () => {
    // Returns data only for "a"; "b" is absent from the result (no data).
    const fetchMissing = vi.fn(async (_ids: string[]) => ({ a: { v: "A" } }));
    const { result, rerender } = renderHook(
      ({ ids }: { ids: string[] }) =>
        useRunBatchAccumulator<Val>({
          selectedRunIds: ids,
          wipeKey: "k",
          queryKeyBase: ["test-empty"],
          fetchMissing,
        }),
      { wrapper: makeWrapper(), initialProps: { ids: ["a", "b"] } },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(fetchMissing).toHaveBeenCalledTimes(1);
    // Only "a" has data; "b" is simply absent.
    expect(result.current.data).toEqual({ a: { v: "A" } });

    // Re-selecting the same set must not re-request the empty "b".
    rerender({ ids: ["b", "a"] });
    expect(fetchMissing).toHaveBeenCalledTimes(1);
  });

  it("wipes and refetches everything when wipeKey changes", async () => {
    const fetchMissing = makeFetcher();
    const { result, rerender } = renderHook(
      ({ wipeKey }: { wipeKey: string }) =>
        useRunBatchAccumulator<Val>({
          selectedRunIds: ["a", "b"],
          wipeKey,
          queryKeyBase: ["test-wipe"],
          fetchMissing,
        }),
      { wrapper: makeWrapper(), initialProps: { wipeKey: "k1" } },
    );

    await waitFor(() =>
      expect(result.current.data).toEqual({ a: { v: "A" }, b: { v: "B" } }),
    );
    expect(fetchMissing).toHaveBeenCalledTimes(1);

    // New wipeKey (e.g. logName/prefix changed) resets the accumulator, so the
    // same runs are fetched again rather than served from the stale map.
    rerender({ wipeKey: "k2" });
    await waitFor(() => expect(fetchMissing).toHaveBeenCalledTimes(2));
    expect(fetchMissing).toHaveBeenLastCalledWith(["a", "b"]);
    expect(result.current.data).toEqual({ a: { v: "A" }, b: { v: "B" } });
  });
});
