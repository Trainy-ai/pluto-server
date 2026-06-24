import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { MetricResultsList } from "../metric-results-list";

// The Radix Tooltip portals nothing useful for jsdom + introduces async
// behavior. Stub it out so the component renders deterministically.
vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

afterEach(() => cleanup());

const NOOP = () => {};

// `showSkeleton` is the visual fix for the dropdown-flash bug: when a
// caller is still fanning out N+1 eligible-prefix queries, the
// regular-metrics result lands first and rows pop in 1-2s later. The
// skeleton mode renders fixed-count placeholder rows INSTEAD of
// partial data so the dropdown stays visually stable.

describe("MetricResultsList — showSkeleton", () => {
  it("U6a: renders 8 placeholder rows when showSkeleton is true", () => {
    render(
      <MetricResultsList
        metrics={["a", "b", "c"]}
        selectedValues={[]}
        isLoading={false}
        emptyMessage="No matches"
        onToggle={NOOP}
        showSkeleton
      />,
    );
    // No real metric rows render — the placeholder shimmer takes over.
    expect(screen.queryByText("a")).toBeNull();
    expect(screen.queryByText("b")).toBeNull();
    expect(screen.queryByText("c")).toBeNull();

    // The header reads "Loading...", same as `isLoading`.
    expect(screen.getByText("Loading...")).toBeTruthy();

    // 8 placeholder rows each containing two animate-pulse divs (icon + text bar).
    // We assert via the icon placeholder count which is the most stable selector.
    const placeholders = document.querySelectorAll(".animate-pulse");
    // 8 rows × 2 placeholder elements per row = 16.
    expect(placeholders.length).toBe(16);
  });

  it("U6b: when showSkeleton is false, renders the real metric rows", () => {
    render(
      <MetricResultsList
        metrics={["train/loss", "train/lr"]}
        selectedValues={[]}
        isLoading={false}
        emptyMessage="No matches"
        onToggle={NOOP}
      />,
    );
    expect(screen.getByText("train/loss")).toBeTruthy();
    expect(screen.getByText("train/lr")).toBeTruthy();
    // No shimmer placeholders when not in skeleton mode.
    expect(document.querySelectorAll(".animate-pulse").length).toBe(0);
  });

  it("U6c: showSkeleton wins over isLoading (no Searching... spinner when both are true)", () => {
    // Callers combine flags: isLoading is for "search call in flight"; showSkeleton
    // is for "deeper fan-out still in flight". If both, the stable skeleton wins.
    render(
      <MetricResultsList
        metrics={[]}
        selectedValues={[]}
        isLoading
        emptyMessage="No matches"
        onToggle={NOOP}
        showSkeleton
      />,
    );
    expect(screen.queryByText("Searching...")).toBeNull();
    expect(document.querySelectorAll(".animate-pulse").length).toBe(16);
  });
});

describe("MetricResultsList — truncated count suffix", () => {
  it("renders '500+ metrics' when truncated is true", () => {
    const items = Array.from({ length: 500 }, (_, i) => `m${i}`);
    render(
      <MetricResultsList
        metrics={items}
        selectedValues={[]}
        isLoading={false}
        emptyMessage="No matches"
        onToggle={NOOP}
        truncated
      />,
    );
    expect(screen.getByText("500+ metrics")).toBeTruthy();
  });
});
