import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { TruncatedLabel } from "../truncated-label";

// jsdom has no pointer events / portals, so render the tooltip parts inline:
// what matters here is whether TooltipContent is mounted at all.
vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="tooltip-content">{children}</div>
  ),
}));

// jsdom lays nothing out (scrollWidth === clientWidth === 0), so every label
// here measures as NOT truncated.
describe("TruncatedLabel", () => {
  afterEach(cleanup);

  it("shows no tooltip for a label that fits", () => {
    render(<TruncatedLabel text="Dec 18, 08:14 PM" title="Dec 18, 2025, 08:14:00 PM UTC" />);
    expect(screen.getByText("Dec 18, 08:14 PM")).toBeDefined();
    expect(screen.queryByTestId("tooltip-content")).toBeNull();
  });

  it("shows the title on hover even when not truncated with alwaysShowTitle", () => {
    render(
      <TruncatedLabel
        text="Dec 18, 08:14 PM"
        title="Dec 18, 2025, 08:14:00 PM UTC"
        alwaysShowTitle
      />,
    );
    expect(screen.getByTestId("tooltip-content").textContent).toBe(
      "Dec 18, 2025, 08:14:00 PM UTC",
    );
  });

  it("shows no tooltip with alwaysShowTitle when there is no title", () => {
    render(<TruncatedLabel text="gpu-node-01" alwaysShowTitle />);
    expect(screen.queryByTestId("tooltip-content")).toBeNull();
  });
});
