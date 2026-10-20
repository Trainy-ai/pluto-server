import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { MediaFullscreenDialog } from "../media-fullscreen-dialog";

describe("MediaFullscreenDialog", () => {
  afterEach(cleanup);

  // Regression: the default 16px corner X at 70% opacity drew rage clicks.
  it("renders a button-sized, opaque Close control", () => {
    render(
      <MediaFullscreenDialog open onOpenChange={() => {}} title="media">
        <div />
      </MediaFullscreenDialog>,
    );

    const close = screen.getByRole("button", { name: "Close" });
    expect(close.className).toContain("size-9");
    expect(close.className).toContain("opacity-100");
    expect(close.className).not.toContain("opacity-70");
  });
});
