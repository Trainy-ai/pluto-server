import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { RunningIndicator } from "../running-indicator";

describe("RunningIndicator", () => {
  afterEach(cleanup);

  it("renders a single labelled live indicator", () => {
    render(<RunningIndicator />);
    const indicator = screen.getByTestId("running-indicator");
    expect(indicator).toBeDefined();
    expect(indicator.getAttribute("aria-label")).toBe("Running");
    expect(indicator.getAttribute("role")).toBe("img");
  });

  it("includes a pulsing (animated) halo element", () => {
    render(<RunningIndicator />);
    const indicator = screen.getByTestId("running-indicator");
    const halo = indicator.querySelector('[class*="animate-"]');
    expect(halo).not.toBeNull();
  });

  it("merges a custom className onto the root without dropping its size", () => {
    render(<RunningIndicator className="size-3" />);
    const indicator = screen.getByTestId("running-indicator");
    expect(indicator.className).toContain("size-3");
  });
});
