import { describe, it, expect } from "vitest";
import { render, renderHook, act } from "@testing-library/react";
import type { ReactNode } from "react";
import { ImageStepSyncProvider } from "@/routes/o.$orgSlug._authed/(run)/projects.$projectName.$runId/~context/image-step-sync-context";
import { useSampleIndexSync } from "../use-sample-index-sync";

type Sync = ReturnType<typeof useSampleIndexSync>;

const wrapper = ({ children }: { children: ReactNode }) => (
  <ImageStepSyncProvider>{children}</ImageStepSyncProvider>
);

/**
 * Mount TWO widget hooks under ONE shared provider (renderHook would give each
 * its own provider, defeating the cross-widget test). The returned object's
 * `.a`/`.b` are reassigned on every render, so they always hold the latest
 * hook return.
 */
function renderTwoWidgets() {
  const slots = {} as { a: Sync; b: Sync };
  function Probe() {
    slots.a = useSampleIndexSync();
    slots.b = useSampleIndexSync();
    return null;
  }
  render(
    <ImageStepSyncProvider>
      <Probe />
    </ImageStepSyncProvider>,
  );
  return slots;
}

describe("useSampleIndexSync", () => {
  it("defaults to 'widgets' mode", () => {
    const { result } = renderHook(() => useSampleIndexSync(), { wrapper });
    expect(result.current.mode).toBe("widgets");
  });

  it("off: each run steps independently", () => {
    const { result } = renderHook(() => useSampleIndexSync(), { wrapper });
    act(() => result.current.setMode("off"));
    act(() => result.current.handleIndexChange("runA", 2));
    expect(result.current.resolveIndex("runA", null, 4)).toBe(2);
    expect(result.current.resolveIndex("runB", null, 4)).toBe(0);
  });

  it("runs: every run in the widget shares one index", () => {
    const { result } = renderHook(() => useSampleIndexSync(), { wrapper });
    act(() => result.current.setMode("runs"));
    act(() => result.current.handleIndexChange("runA", 3));
    expect(result.current.resolveIndex("runA", null, 5)).toBe(3);
    expect(result.current.resolveIndex("runB", null, 5)).toBe(3);
  });

  it("widgets: the index is shared ACROSS widgets via the provider", () => {
    const w = renderTwoWidgets();
    expect(w.a.mode).toBe("widgets");
    act(() => w.a.handleIndexChange("runA", 3));
    // widget B (also in 'widgets') follows widget A's index
    expect(w.b.resolveIndex("runA", null, 5)).toBe(3);
  });

  it("runs mode does NOT leak across widgets", () => {
    const w = renderTwoWidgets();
    act(() => w.a.setMode("runs"));
    act(() => w.b.setMode("runs"));
    act(() => w.a.handleIndexChange("runA", 3));
    expect(w.a.resolveIndex("runA", null, 5)).toBe(3);
    expect(w.b.resolveIndex("runA", null, 5)).toBe(0); // isolated from A
  });

  it("is sticky across step changes (a changed sample count doesn't reset it)", () => {
    const { result } = renderHook(() => useSampleIndexSync(), { wrapper });
    act(() => result.current.handleIndexChange("runA", 3));
    expect(result.current.resolveIndex("runA", null, 6)).toBe(3); // step with 6 samples
    expect(result.current.resolveIndex("runA", null, 4)).toBe(3); // step with 4 samples
    expect(result.current.resolveIndex("runA", null, 2)).toBe(1); // step with 2 → clamps
  });

  it("switching widgets→runs keeps the current sample (no snap to 0)", () => {
    const w = renderTwoWidgets();
    act(() => w.a.handleIndexChange("runA", 3)); // both in 'widgets', shared = 3
    expect(w.b.resolveIndex("runA", null, 5)).toBe(3);
    act(() => w.b.setMode("runs")); // opt B out of cross-widget sync
    expect(w.b.resolveIndex("runA", null, 5)).toBe(3); // kept, not reset
  });

  // Rejoining "widgets" RE-ADOPTS the tandem's index; the runs-mode detour is
  // discarded — it must NOT drag the other widgets to its value.
  it("switching runs→widgets re-adopts the tandem (discards the runs detour)", () => {
    const w = renderTwoWidgets();
    act(() => w.b.handleIndexChange("runA", 3)); // b (widgets) sets tandem = 3
    act(() => w.a.setMode("runs"));
    act(() => w.a.handleIndexChange("runA", 1)); // a wanders to 1 in runs mode
    expect(w.a.resolveIndex("runA", null, 5)).toBe(1); // runs shows its own 1
    act(() => w.a.setMode("widgets")); // rejoin tandem
    expect(w.a.resolveIndex("runA", null, 5)).toBe(3); // adopts the tandem, not 1
    expect(w.b.resolveIndex("runA", null, 5)).toBe(3); // b unchanged
  });

  // The user's exact scenario: all at 1/N, one widget wanders in "runs", then
  // rejoins → snaps back to the (untouched) tandem's 1/N, not its runs value.
  it("rejoining an untouched tandem snaps back to 1/N (not the runs value)", () => {
    const w = renderTwoWidgets();
    act(() => w.a.setMode("runs"));
    act(() => w.a.handleIndexChange("runA", 1)); // a wanders to index 1 (2/3)
    expect(w.a.resolveIndex("runA", null, 3)).toBe(1);
    act(() => w.a.setMode("widgets")); // rejoin the untouched tandem
    expect(w.a.resolveIndex("runA", null, 3)).toBe(0); // index 0 == 1/3
  });

  it("works without a provider (falls back to local state)", () => {
    const { result } = renderHook(() => useSampleIndexSync()); // no wrapper
    expect(result.current.mode).toBe("widgets");
    act(() => result.current.handleIndexChange("runA", 2));
    expect(result.current.resolveIndex("runA", null, 4)).toBe(2);
  });
});
