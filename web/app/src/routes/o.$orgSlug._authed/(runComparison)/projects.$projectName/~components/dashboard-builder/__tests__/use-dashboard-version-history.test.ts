import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DashboardView } from "../../../~queries/dashboard-views";
import { useDashboardVersionHistory } from "../use-dashboard-version-history";

const mocks = vi.hoisted(() => ({
  mutate: vi.fn(),
}));

vi.mock("../../../~queries/dashboard-views", () => ({
  useDashboardVersion: () => ({ data: undefined }),
  useRestoreDashboardVersion: () => ({
    isPending: false,
    mutate: mocks.mutate,
  }),
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

const view = {
  id: "12",
  currentVersion: 2,
  updatedAt: "2026-08-26T00:00:00.000Z",
  config: { version: 1, sections: [] },
} as unknown as DashboardView;

describe("useDashboardVersionHistory", () => {
  beforeEach(() => {
    mocks.mutate.mockReset();
    vi.spyOn(window, "confirm").mockReturnValue(true);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("keeps unsaved edits when the current history row is selected", () => {
    const onDiscardEditing = vi.fn();
    const onReturnToCurrent = vi.fn();
    const { result } = renderHook(() =>
      useDashboardVersionHistory({
        view,
        organizationId: "org-1",
        projectName: "project-1",
        isEditing: true,
        hasChanges: true,
        onDiscardEditing,
        onPreviewLoaded: vi.fn(),
        onReturnToCurrent,
        onRestoreSuccess: vi.fn(),
      }),
    );

    act(() => {
      result.current.setIsHistoryOpen(true);
      result.current.selectVersion(2);
    });

    expect(result.current.isHistoryOpen).toBe(false);
    expect(result.current.previewVersion).toBeNull();
    expect(window.confirm).not.toHaveBeenCalled();
    expect(onDiscardEditing).not.toHaveBeenCalled();
    expect(onReturnToCurrent).not.toHaveBeenCalled();
  });

  it("submits only one restore while a mutation is in flight", () => {
    const { result } = renderHook(() =>
      useDashboardVersionHistory({
        view,
        organizationId: "org-1",
        projectName: "project-1",
        isEditing: false,
        hasChanges: false,
        onDiscardEditing: vi.fn(),
        onPreviewLoaded: vi.fn(),
        onReturnToCurrent: vi.fn(),
        onRestoreSuccess: vi.fn(),
      }),
    );

    act(() => result.current.selectVersion(1));
    act(() => {
      result.current.restoreVersion();
      result.current.restoreVersion();
    });

    expect(mocks.mutate).toHaveBeenCalledTimes(1);
    expect(mocks.mutate).toHaveBeenCalledWith(
      {
        organizationId: "org-1",
        viewId: "12",
        version: 1,
        expectedUpdatedAt: "2026-08-26T00:00:00.000Z",
      },
      expect.objectContaining({
        onError: expect.any(Function),
        onSettled: expect.any(Function),
        onSuccess: expect.any(Function),
      }),
    );
  });

  it("publishes the restored version before the view query refreshes", () => {
    const onRestoreSuccess = vi.fn();
    const { result } = renderHook(() =>
      useDashboardVersionHistory({
        view,
        organizationId: "org-1",
        projectName: "project-1",
        isEditing: false,
        hasChanges: false,
        onDiscardEditing: vi.fn(),
        onPreviewLoaded: vi.fn(),
        onReturnToCurrent: vi.fn(),
        onRestoreSuccess,
      }),
    );

    act(() => result.current.selectVersion(1));
    act(() => result.current.restoreVersion());

    const { onSuccess } = mocks.mutate.mock.calls[0][1];
    const restored = { ...view, currentVersion: 3 };
    act(() => onSuccess(restored));

    expect(result.current.currentVersion).toBe(3);
    expect(onRestoreSuccess).toHaveBeenCalledWith(restored);
  });
});
