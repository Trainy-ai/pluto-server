import { describe, it, expect, afterEach } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";
import { useHiddenRunIds } from "../use-hidden-run-ids";

afterEach(() => {
  cleanup();
  // Reset module-level state by dispatching an empty set
  document.dispatchEvent(
    new CustomEvent("run-visibility-change", { detail: new Set<string>() }),
  );
});

function dispatchVisibilityChange(ids: Set<string>) {
  document.dispatchEvent(
    new CustomEvent("run-visibility-change", { detail: ids }),
  );
}

describe("useHiddenRunIds", () => {
  it("starts with an empty set on first use", () => {
    const { result } = renderHook(() => useHiddenRunIds());
    expect(result.current.size).toBe(0);
  });

  it("updates when a run-visibility-change event is dispatched", () => {
    const { result } = renderHook(() => useHiddenRunIds());

    act(() => {
      dispatchVisibilityChange(new Set(["run-1", "run-2"]));
    });

    expect(result.current).toEqual(new Set(["run-1", "run-2"]));
  });

  it("newly mounted hooks reflect the latest hidden state", () => {
    // First hook receives the event and updates module-level state
    const { result: first } = renderHook(() => useHiddenRunIds());

    act(() => {
      dispatchVisibilityChange(new Set(["run-1"]));
    });

    expect(first.current).toEqual(new Set(["run-1"]));

    // Second hook mounts AFTER the event — should still see "run-1" hidden
    // This simulates VirtualizedChart remounting a component after scroll
    const { result: second } = renderHook(() => useHiddenRunIds());

    expect(second.current).toEqual(new Set(["run-1"]));
  });

  it("unmounted and remounted hooks pick up hidden state", () => {
    const { result, unmount } = renderHook(() => useHiddenRunIds());

    act(() => {
      dispatchVisibilityChange(new Set(["run-a"]));
    });
    expect(result.current).toEqual(new Set(["run-a"]));

    // Unmount (simulates VirtualizedChart removing component from DOM)
    unmount();

    // Event fires while unmounted
    act(() => {
      dispatchVisibilityChange(new Set(["run-a", "run-b"]));
    });

    // Remount — should see the latest state, not the stale one
    const { result: remounted } = renderHook(() => useHiddenRunIds());
    expect(remounted.current).toEqual(new Set(["run-a", "run-b"]));
  });

  it("clears hidden state when an empty set is dispatched", () => {
    const { result } = renderHook(() => useHiddenRunIds());

    act(() => {
      dispatchVisibilityChange(new Set(["run-1"]));
    });
    expect(result.current.size).toBe(1);

    act(() => {
      dispatchVisibilityChange(new Set());
    });
    expect(result.current.size).toBe(0);
  });
});
