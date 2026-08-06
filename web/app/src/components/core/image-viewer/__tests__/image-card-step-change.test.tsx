/**
 * The fullscreen dialog must survive a step change.
 *
 * Stepping through images swaps the card's `url`/`annotations` props while the
 * Radix `<Dialog>` inside it holds its open state internally, in an unmounted-
 * on-destroy portal. So the card must NOT be remounted when the step changes —
 * which is why the image grids key their cards by grid position rather than by
 * anything derived from the file.
 *
 * A key that encoded the step shipped once and broke the E2E
 * "[IR-C] step navigator works in fullscreen and dialog persists on step
 * change" deterministically. That spec runs against CI-seeded data, so this
 * test guards the same invariant at the component level, where it can run
 * anywhere.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { ImageCard } from "../image-card";

beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  // Radix measures and scrolls; jsdom implements neither.
  Element.prototype.scrollTo = vi.fn();
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Opens the zoom dialog the way a user does — clicking the thumbnail. */
function openDialog() {
  fireEvent.click(screen.getByRole("img", { hidden: true }));
  return screen.getByRole("dialog");
}

describe("ImageCard across a step change", () => {
  it("keeps the fullscreen dialog open when the image changes", () => {
    const { rerender } = render(
      <ImageCard url="step-0.png" fileName="a.png" currentStepValue={0} />,
    );
    expect(openDialog()).toBeDefined();

    // Exactly what a step change does: same element position, new image.
    rerender(<ImageCard url="step-1.png" fileName="b.png" currentStepValue={1} />);

    // The regression: the dialog vanished here because the card was remounted.
    expect(screen.getByRole("dialog")).toBeDefined();
    // ...and it is showing the NEW image, not a frozen copy of the old one.
    const dialogImgs = screen
      .getAllByRole("img", { hidden: true })
      .map((el) => el.getAttribute("src"));
    expect(dialogImgs).toContain("step-1.png");
    expect(dialogImgs).not.toContain("step-0.png");
  });

  it("keeps the dialog open when the image gains annotations", () => {
    // The annotated and un-annotated branches render different subtrees, which
    // is another way a step change could tear the dialog down.
    const { rerender } = render(
      <ImageCard url="step-0.png" fileName="a.png" currentStepValue={0} />,
    );
    expect(openDialog()).toBeDefined();

    rerender(
      <ImageCard
        url="step-1.png"
        fileName="b.png"
        currentStepValue={1}
        annotations={JSON.stringify({
          boxes: { predictions: { box_data: [], class_labels: { 1: "cat" } } },
        })}
      />,
    );

    expect(screen.getByRole("dialog")).toBeDefined();
  });

  it("preserves card-local state across the change, proving no remount", () => {
    // Zoom lives in the card's own state. If it survives, the instance did.
    const { rerender } = render(
      <ImageCard url="step-0.png" fileName="a.png" currentStepValue={0} />,
    );
    openDialog();

    const zoomIn = screen
      .getAllByRole("button")
      .find((b) => b.querySelector("svg.lucide-zoom-in"));
    expect(zoomIn).toBeDefined();
    fireEvent.click(zoomIn!);
    fireEvent.click(zoomIn!);
    const zoomedText = screen.getByText(/%/).textContent;
    expect(zoomedText).not.toBe("100%");

    rerender(<ImageCard url="step-1.png" fileName="b.png" currentStepValue={1} />);

    expect(screen.getByText(/%/).textContent).toBe(zoomedText);
  });
});
