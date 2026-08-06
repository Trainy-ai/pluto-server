/**
 * The image grid must not remount its cards when the step changes.
 *
 * Each card owns a Radix `<Dialog>` whose open state is internal and whose
 * content lives in a portal, so remounting the card closes the fullscreen
 * viewer out from under the user mid-interaction. The grid is already filtered
 * to the current step, so a key derived from the file — `${step}-${fileName}`,
 * say — changes on every step change and remounts everything.
 *
 * That exact key shipped once and broke the E2E "[IR-C] step navigator works in
 * fullscreen and dialog persists on step change" deterministically. That spec
 * needs CI-seeded data, so this test pins the same invariant here, where it
 * runs anywhere: drive the real step slider and assert the card's DOM node is
 * the same object afterwards.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";

const FILES = [
  { step: 0, fileName: "a.png", fileType: "png", url: "s0.png", caption: null, annotations: null },
  { step: 1, fileName: "b.png", fileType: "png", url: "s1.png", caption: null, annotations: null },
  { step: 2, fileName: "c.png", fileType: "png", url: "s2.png", caption: null, annotations: null },
];

vi.mock("../../../~queries/get-images", () => ({
  useGetImages: () => ({ data: FILES, isLoading: false }),
}));

import { ImagesView } from "../images";
import { RendererErrorBoundary } from "@/components/shared/renderer-error-boundary";

beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  Element.prototype.scrollTo = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function renderGrid() {
  return render(
    <ImagesView
      log={{ logName: "val/images" } as never}
      tenantId="org"
      projectName="proj"
      runId="run"
    />,
  );
}

/** The one card in the grid, as a DOM node whose identity we can compare. */
function cardImage() {
  return screen.getByTestId("image-widget").querySelector("img")!;
}

describe("ImagesView step changes", () => {
  it("reuses the same card element when the step changes", () => {
    renderGrid();

    const before = cardImage();
    expect(before.getAttribute("src")).toBe("s2.png"); // stepper starts at last

    const slider = within(screen.getByTestId("image-widget")).getAllByLabelText(
      "step",
    )[0];
    fireEvent.change(slider, { target: { value: "0" } });

    const after = cardImage();
    // Same object, not merely an equivalent one: a changed key would have
    // produced a fresh element (and taken any open dialog with it).
    expect(after).toBe(before);
    // ...while still showing the new step's image.
    expect(after.getAttribute("src")).toBe("s0.png");
  });

  it("does not trip the tile's error boundary", () => {
    // group.tsx wraps every tile in a RendererErrorBoundary, which would show
    // "Preview unavailable" — and unmount the card, dialog and all — if
    // anything threw while re-rendering for a new step. Rules it in or out as a
    // second cause of the dialog disappearing, rather than assuming.
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <RendererErrorBoundary label="val/images">
        <ImagesView
          log={{ logName: "val/images" } as never}
          tenantId="org"
          projectName="proj"
          runId="run"
        />
      </RendererErrorBoundary>,
    );

    const slider = within(screen.getByTestId("image-widget")).getAllByLabelText(
      "step",
    )[0];
    fireEvent.change(slider, { target: { value: "0" } });
    fireEvent.change(slider, { target: { value: "2" } });

    expect(screen.queryByText("Preview unavailable")).toBeNull();
    expect(screen.getByTestId("image-widget")).toBeDefined();
    expect(
      consoleError.mock.calls.filter((c) =>
        String(c[0]).includes("RendererErrorBoundary"),
      ),
    ).toHaveLength(0);
  });

  it("survives stepping back and forth", () => {
    renderGrid();
    const before = cardImage();
    const slider = within(screen.getByTestId("image-widget")).getAllByLabelText(
      "step",
    )[0];

    fireEvent.change(slider, { target: { value: "0" } });
    fireEvent.change(slider, { target: { value: "1" } });
    fireEvent.change(slider, { target: { value: "2" } });

    expect(cardImage()).toBe(before);
    expect(cardImage().getAttribute("src")).toBe("s2.png");
  });
});
