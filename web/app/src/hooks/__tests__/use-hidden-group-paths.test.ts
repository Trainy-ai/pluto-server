import { describe, it, expect, afterEach } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";
import { useHiddenGroupPaths } from "../use-hidden-group-paths";

afterEach(() => {
  cleanup();
  // Reset module-level state by dispatching an empty set.
  document.dispatchEvent(
    new CustomEvent("group-visibility-change", { detail: new Set<string>() }),
  );
});

function dispatchGroupVisibility(paths: Set<string>) {
  document.dispatchEvent(
    new CustomEvent("group-visibility-change", { detail: paths }),
  );
}

describe("useHiddenGroupPaths", () => {
  it("updates when a group-visibility-change event is dispatched", () => {
    const { result } = renderHook(() => useHiddenGroupPaths());
    act(() => {
      dispatchGroupVisibility(new Set(["group:a", "group:b"]));
    });
    expect(result.current).toEqual(new Set(["group:a", "group:b"]));
  });

  it("newly mounted hooks reflect the latest hidden state", () => {
    const { result: first } = renderHook(() => useHiddenGroupPaths());
    act(() => {
      dispatchGroupVisibility(new Set(["group:a"]));
    });
    expect(first.current).toEqual(new Set(["group:a"]));

    // A hook that mounts AFTER the event (e.g. a bucket row scrolled back into
    // view) still sees the current hidden set.
    const { result: second } = renderHook(() => useHiddenGroupPaths());
    expect(second.current).toEqual(new Set(["group:a"]));
  });

  it("clears hidden state when an empty set is dispatched", () => {
    const { result } = renderHook(() => useHiddenGroupPaths());
    act(() => {
      dispatchGroupVisibility(new Set(["group:a"]));
    });
    expect(result.current.size).toBe(1);
    act(() => {
      dispatchGroupVisibility(new Set());
    });
    expect(result.current.size).toBe(0);
  });

  // Project-scoping (the leak fix): the module snapshot is global, but group
  // path-keys like `group:a` collide across projects, so navigating to a
  // different project must NOT carry hidden groups over.
  it("clears the snapshot when the project changes", () => {
    const { result, rerender } = renderHook(
      ({ project }) => useHiddenGroupPaths(project),
      { initialProps: { project: "proj-a" } },
    );
    act(() => {
      dispatchGroupVisibility(new Set(["group:a"]));
    });
    expect(result.current.has("group:a")).toBe(true);

    // Navigate to another project → hidden groups from proj-a must not leak in.
    rerender({ project: "proj-b" });
    expect(result.current.size).toBe(0);
  });

  it("keeps hidden groups while the project is unchanged", () => {
    const { result, rerender } = renderHook(
      ({ project }) => useHiddenGroupPaths(project),
      { initialProps: { project: "proj-x" } },
    );
    act(() => {
      dispatchGroupVisibility(new Set(["group:x", "group:y"]));
    });
    expect(result.current.size).toBe(2);

    // Re-render with the SAME project (e.g. an unrelated prop change) keeps them.
    rerender({ project: "proj-x" });
    expect(result.current.size).toBe(2);
  });
});
