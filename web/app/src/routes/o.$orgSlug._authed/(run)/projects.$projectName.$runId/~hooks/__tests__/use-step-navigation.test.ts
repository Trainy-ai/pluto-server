import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useStepNavigation } from "../use-step-navigation";

describe("useStepNavigation", () => {
  it("defaults to the last step when data first arrives", () => {
    const data = [{ step: 0 }, { step: 1 }, { step: 2 }];
    const { result } = renderHook(() => useStepNavigation(data));
    expect(result.current.availableSteps).toEqual([0, 1, 2]);
    expect(result.current.currentStepIndex).toBe(2);
    expect(result.current.currentStepValue).toBe(2);
  });

  it("advances to the new last step when more steps arrive and the user was tracking max", () => {
    // Simulates the histogram CI flake: data arrives in two stages
    // (e.g. cached partial array first, then the full server response). Without
    // the fix, currentStepIndex stays pinned to the old length-1 even though
    // the visible last step has moved.
    const initialData = [{ step: 0 }, { step: 3 }, { step: 6 }];
    const { result, rerender } = renderHook(
      ({ data }: { data: { step: number }[] }) => useStepNavigation(data),
      { initialProps: { data: initialData } },
    );
    expect(result.current.currentStepIndex).toBe(2); // tracking max of [0,3,6]

    const fullData = [
      { step: 0 }, { step: 3 }, { step: 6 }, { step: 9 }, { step: 12 },
      { step: 15 }, { step: 18 }, { step: 21 }, { step: 24 }, { step: 27 },
    ];
    rerender({ data: fullData });
    expect(result.current.availableSteps).toHaveLength(10);
    expect(result.current.currentStepIndex).toBe(9); // should have advanced to new max
    expect(result.current.currentStepValue).toBe(27);
  });

  it("preserves user-chosen step when more data arrives", () => {
    // Inverse of the above: if the user has navigated AWAY from the last step,
    // a data update must NOT yank them back to max.
    const initialData = [{ step: 0 }, { step: 3 }, { step: 6 }];
    const { result, rerender } = renderHook(
      ({ data }: { data: { step: number }[] }) => useStepNavigation(data),
      { initialProps: { data: initialData } },
    );
    act(() => result.current.goToStepIndex(0));
    expect(result.current.currentStepIndex).toBe(0);

    const fullData = [
      { step: 0 }, { step: 3 }, { step: 6 }, { step: 9 }, { step: 12 },
    ];
    rerender({ data: fullData });
    expect(result.current.currentStepIndex).toBe(0); // sticky — user moved off max
  });
});
