import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { useSearchOtherMatches } from "../use-search-other-matches";
import type { Run } from "../../~queries/list-runs";

// Mock the trpcClient so we control what runs.list returns.
const mockListQuery = vi.fn();
vi.mock("@/utils/trpc", () => ({
  trpc: {
    runs: {
      list: {
        queryKey: (input: unknown) => ["runs.list", input],
      },
    },
  },
  trpcClient: {
    runs: {
      list: {
        query: (...args: unknown[]) => mockListQuery(...args),
      },
    },
  },
}));

function makeRun(id: string): Run {
  return {
    id,
    name: `run-${id}`,
    displayId: `TES-${id}`,
    status: "COMPLETED",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    tags: [],
    notes: null,
    _flatConfig: {},
    _flatSystemMetadata: {},
  } as unknown as Run;
}

function makeWrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: qc }, children);
  };
}

describe("useSearchOtherMatches", () => {
  beforeEach(() => {
    mockListQuery.mockReset();
    mockListQuery.mockResolvedValue({ runs: [], nextCursor: null });
  });

  it("is disabled and does NOT fetch when query is empty", () => {
    const { result } = renderHook(
      () =>
        useSearchOtherMatches({
          organizationId: "org-1",
          projectName: "proj-1",
          query: "",
          inViewRunIds: new Set(),
          filterActive: true,
          displayOnlySelectedActive: false,
          pinSelectedToTopActive: false,
        }),
      { wrapper: makeWrapper() },
    );
    expect(mockListQuery).not.toHaveBeenCalled();
    expect(result.current.outOfView).toEqual([]);
    expect(result.current.inView).toEqual([]);
  });

  it("is disabled when neither filter nor display-only-selected is active", () => {
    renderHook(
      () =>
        useSearchOtherMatches({
          organizationId: "org-1",
          projectName: "proj-1",
          query: "run-01",
          inViewRunIds: new Set(),
          filterActive: false,
          displayOnlySelectedActive: false,
          pinSelectedToTopActive: false,
        }),
      { wrapper: makeWrapper() },
    );
    expect(mockListQuery).not.toHaveBeenCalled();
  });

  it("enabled when filter is active — fetches with no filter params", async () => {
    mockListQuery.mockResolvedValue({
      runs: [makeRun("A"), makeRun("B")],
      nextCursor: null,
    });

    renderHook(
      () =>
        useSearchOtherMatches({
          organizationId: "org-1",
          projectName: "proj-1",
          query: "run-A",
          inViewRunIds: new Set(),
          filterActive: true,
          displayOnlySelectedActive: false,
          pinSelectedToTopActive: false,
        }),
      { wrapper: makeWrapper() },
    );

    await vi.waitFor(() => expect(mockListQuery).toHaveBeenCalled());

    const callArg = mockListQuery.mock.calls[0][0];
    expect(callArg.search).toBe("run-A");
    expect(callArg.tags).toBeUndefined();
    expect(callArg.status).toBeUndefined();
    expect(callArg.dateFilters).toBeUndefined();
    expect(callArg.fieldFilters).toBeUndefined();
    expect(callArg.metricFilters).toBeUndefined();
    expect(callArg.systemFilters).toBeUndefined();
  });

  it("enabled when display-only-selected is on", async () => {
    renderHook(
      () =>
        useSearchOtherMatches({
          organizationId: "org-1",
          projectName: "proj-1",
          query: "run-A",
          inViewRunIds: new Set(),
          filterActive: false,
          displayOnlySelectedActive: true,
          pinSelectedToTopActive: false,
        }),
      { wrapper: makeWrapper() },
    );
    await vi.waitFor(() => expect(mockListQuery).toHaveBeenCalled());
  });

  it("partitions returned runs into inView and outOfView", async () => {
    mockListQuery.mockResolvedValue({
      runs: [makeRun("A"), makeRun("B"), makeRun("C")],
      nextCursor: null,
    });

    const { result } = renderHook(
      () =>
        useSearchOtherMatches({
          organizationId: "org-1",
          projectName: "proj-1",
          query: "run",
          inViewRunIds: new Set(["A"]),
          filterActive: true,
          displayOnlySelectedActive: false,
          pinSelectedToTopActive: false,
        }),
      { wrapper: makeWrapper() },
    );

    await vi.waitFor(() => expect(result.current.outOfView.length).toBeGreaterThan(0));

    expect(result.current.inView.map((r) => r.id)).toEqual(["A"]);
    expect(result.current.outOfView.map((r) => r.id).sort()).toEqual(["B", "C"]);
  });

  it("is disabled when caller passes enabled=false (even with non-empty query + active filter)", () => {
    renderHook(
      () =>
        useSearchOtherMatches({
          organizationId: "org-1",
          projectName: "proj-1",
          query: "run-A",
          inViewRunIds: new Set(),
          filterActive: true,
          displayOnlySelectedActive: false,
          pinSelectedToTopActive: false,
          enabled: false,
        }),
      { wrapper: makeWrapper() },
    );
    expect(mockListQuery).not.toHaveBeenCalled();
  });
});
