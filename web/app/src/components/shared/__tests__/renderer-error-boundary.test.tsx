/**
 * The boundary has to satisfy two requirements that pull against each other:
 *
 *   1. A caught error must not outlive the thing that caused it. One
 *      unrenderable artifact used to leave "Preview unavailable" showing for
 *      every file selected afterwards, because the error sits in state.
 *   2. Clearing it must NOT remount the children. The obvious fix — a `key` on
 *      the boundary — also throws away state the children own, which in the
 *      file browser meant the image zoom reset every time you stepped to the
 *      next file.
 *
 * `resetKey` is what satisfies both, so both are pinned here.
 */

import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { useState } from "react";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { RendererErrorBoundary } from "../renderer-error-boundary";

function Boom({ explode }: { explode: boolean }) {
  if (explode) {
    throw new Error("cannot render this artifact");
  }
  return <div data-testid="ok">rendered fine</div>;
}

/** Stands in for the image preview's zoom: state the child owns, not the parent. */
function Zoomable() {
  const [zoom, setZoom] = useState(1);
  return (
    <button data-testid="zoom" onClick={() => setZoom((z) => z + 1)}>
      zoom {zoom}
    </button>
  );
}

beforeEach(() => {
  // React logs every caught error; the boundary logs its own too. Neither is
  // the thing under test, and both make the output unreadable.
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("RendererErrorBoundary", () => {
  it("shows the fallback when a child throws", () => {
    render(
      <RendererErrorBoundary label="a.png" resetKey="a.png">
        <Boom explode />
      </RendererErrorBoundary>,
    );
    expect(screen.getByText("Preview unavailable")).toBeDefined();
    expect(screen.getByText(/"a\.png"/)).toBeDefined();
  });

  it("keeps showing the fallback while the same artifact is selected", () => {
    const { rerender } = render(
      <RendererErrorBoundary label="a.png" resetKey="a.png">
        <Boom explode />
      </RendererErrorBoundary>,
    );
    expect(screen.getByText("Preview unavailable")).toBeDefined();

    // An unrelated re-render must not silently retry and throw again.
    rerender(
      <RendererErrorBoundary label="a.png" resetKey="a.png">
        <Boom explode />
      </RendererErrorBoundary>,
    );
    expect(screen.getByText("Preview unavailable")).toBeDefined();
  });

  it("recovers when the selection moves to another artifact", () => {
    const { rerender } = render(
      <RendererErrorBoundary label="a.png" resetKey="a.png">
        <Boom explode />
      </RendererErrorBoundary>,
    );
    expect(screen.getByText("Preview unavailable")).toBeDefined();

    rerender(
      <RendererErrorBoundary label="b.png" resetKey="b.png">
        <Boom explode={false} />
      </RendererErrorBoundary>,
    );

    expect(screen.queryByText("Preview unavailable")).toBeNull();
    expect(screen.getByTestId("ok")).toBeDefined();
  });

  it("still reports a new failure on the new artifact", () => {
    const { rerender } = render(
      <RendererErrorBoundary resetKey="a.png">
        <Boom explode />
      </RendererErrorBoundary>,
    );
    rerender(
      <RendererErrorBoundary resetKey="b.png">
        <Boom explode />
      </RendererErrorBoundary>,
    );
    // Clearing on key change must not swallow the *next* error.
    expect(screen.getByText("Preview unavailable")).toBeDefined();
  });

  it("does not remount children when resetKey changes", () => {
    // The regression the `key` approach caused: zoom is child state, and
    // stepping to the next file must not reset it.
    const { rerender } = render(
      <RendererErrorBoundary resetKey="a.png">
        <Zoomable />
      </RendererErrorBoundary>,
    );
    fireEvent.click(screen.getByTestId("zoom"));
    fireEvent.click(screen.getByTestId("zoom"));
    expect(screen.getByTestId("zoom").textContent).toBe("zoom 3");

    rerender(
      <RendererErrorBoundary resetKey="b.png">
        <Zoomable />
      </RendererErrorBoundary>,
    );

    expect(screen.getByTestId("zoom").textContent).toBe("zoom 3");
  });

  it("recovers via the Retry button", () => {
    // Controlled by an external flag rather than an attempt counter: React
    // retries a failed render synchronously, so "throw only the first time"
    // never reaches the boundary at all.
    let shouldThrow = true;
    function Flaky() {
      if (shouldThrow) throw new Error("still failing");
      return <div data-testid="ok">rendered fine</div>;
    }

    render(
      <RendererErrorBoundary resetKey="a.png">
        <Flaky />
      </RendererErrorBoundary>,
    );
    expect(screen.getByText("Preview unavailable")).toBeDefined();

    shouldThrow = false;
    fireEvent.click(screen.getByText("Retry"));
    expect(screen.getByTestId("ok")).toBeDefined();
  });

  it("behaves as before when no resetKey is given", () => {
    const { rerender } = render(
      <RendererErrorBoundary>
        <Boom explode />
      </RendererErrorBoundary>,
    );
    rerender(
      <RendererErrorBoundary>
        <Boom explode={false} />
      </RendererErrorBoundary>,
    );
    // No key to compare, so the error stands until Retry — the old behaviour,
    // deliberately unchanged for callers that never opted in.
    expect(screen.getByText("Preview unavailable")).toBeDefined();
  });
});
