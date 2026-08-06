import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

// `@/utils/trpc` validates the VITE_* env at import time and throws without
// them, which is every CI run. The hook only reaches these for real zoom
// queries, and `enabled: false` below keeps all three query lists empty.
vi.mock("@/utils/trpc", () => {
  const endpoint = {
    queryOptions: (input: unknown) => ({ queryKey: ["zoom-test", input] }),
  };
  return {
    trpc: {
      runs: {
        data: {
          graphMultiMetricBatchBucketed: endpoint,
          graphBatchBucketed: endpoint,
          graphBucketed: endpoint,
        },
      },
    },
    trpcClient: {
      runs: {
        data: {
          graphMultiMetricBatchBucketed: { query: vi.fn() },
          graphBatchBucketed: { query: vi.fn() },
          graphBucketed: { query: vi.fn() },
        },
      },
    },
  };
});

import { useZoomRefetch } from "../use-zoom-refetch";

/**
 * Regression guard for the hide-a-run chart-rebuild loop.
 *
 * `onZoomRangeChange` is called from uPlot's setScale hook, which hands over a
 * freshly-built `[min, max]` tuple every time. If the hook stores that tuple
 * unconditionally, re-applying the *same* zoom still counts as a state change:
 * the chart component re-renders, its uPlot data gets a new identity, the chart
 * is destroyed and rebuilt, the rebuild refits the scale, and the setScale hook
 * fires again — ~60 rebuilds/sec for as long as that run is hidden.
 *
 * The chart lifecycle no longer fires that callback for its own refits (see
 * `withProgrammaticScale`), but this bail-out is the second line of defence:
 * it makes a repeated identical range cost nothing.
 */

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function renderZoomRefetch() {
  let renders = 0;
  const hook = renderHook(
    () => {
      renders++;
      return useZoomRefetch({
        organizationId: "org",
        projectName: "proj",
        logNames: ["loss"],
        runIds: ["run-a"],
        selectedLog: "Step",
        // Small bucket count so a wide range counts as "zoomed in" rather than
        // being short-circuited by the max-resolution check.
        buckets: 10,
        enabled: false,
      });
    },
    { wrapper },
  );
  return { hook, getRenders: () => renders };
}

describe("useZoomRefetch zoom-range idempotence", () => {
  it("settles instead of re-rendering once per identical re-application", () => {
    const { hook, getRenders } = renderZoomRefetch();

    // Same numbers, new array every time — exactly what the setScale hook
    // hands over on every commit. Without the bail-out each of these is a
    // fresh state value and renders again, forever.
    act(() => {
      hook.result.current.onZoomRangeChange([10, 200]);
    });
    act(() => {
      hook.result.current.onZoomRangeChange([10, 200]);
    });
    const settled = getRenders();

    act(() => {
      hook.result.current.onZoomRangeChange([10, 200]);
    });
    act(() => {
      hook.result.current.onZoomRangeChange([10, 200]);
    });
    act(() => {
      hook.result.current.onZoomRangeChange([10, 200]);
    });

    expect(getRenders()).toBe(settled);
  });

  it("still re-renders when the range actually changes", () => {
    const { hook, getRenders } = renderZoomRefetch();

    act(() => {
      hook.result.current.onZoomRangeChange([10, 200]);
    });
    const rendersAfterFirst = getRenders();

    act(() => {
      hook.result.current.onZoomRangeChange([20, 200]);
    });
    expect(getRenders()).toBeGreaterThan(rendersAfterFirst);

    const rendersAfterSecond = getRenders();
    act(() => {
      hook.result.current.onZoomRangeChange(null);
    });
    expect(getRenders()).toBeGreaterThan(rendersAfterSecond);
  });

  it("treats a repeated reset to null as a no-op", () => {
    const { hook, getRenders } = renderZoomRefetch();

    act(() => {
      hook.result.current.onZoomRangeChange(null);
    });
    const rendersAfterReset = getRenders();

    act(() => {
      hook.result.current.onZoomRangeChange(null);
    });
    expect(getRenders()).toBe(rendersAfterReset);
  });
});
