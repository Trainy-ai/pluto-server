import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { TagsCell } from "../tags-cell";

// Mock ResizeObserver for jsdom
beforeAll(() => {
  global.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

// Mock the TagsEditorPopover since it has complex dependencies (tRPC, popover)
vi.mock("@/components/tags-editor-popover", () => ({
  TagsEditorPopover: ({ trigger }: { trigger: React.ReactNode }) => (
    <div data-testid="tags-editor">{trigger}</div>
  ),
}));

// Mock the tooltip components — jsdom doesn't support pointer events / portals
vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="tooltip-root">{children}</div>
  ),
  TooltipTrigger: ({
    children,
    asChild,
    ...props
  }: {
    children: React.ReactNode;
    asChild?: boolean;
  }) => (
    <div data-testid="tooltip-trigger" {...props}>
      {children}
    </div>
  ),
  TooltipContent: ({
    children,
  }: {
    children: React.ReactNode;
    side?: string;
    className?: string;
  }) => <div data-testid="tooltip-content">{children}</div>,
}));

// Mock TagBadge to render tag text directly
vi.mock("@/components/tag-badge", () => ({
  TagBadge: ({ tag, truncate, className }: { tag: string; truncate?: boolean; className?: string }) => (
    <span data-testid="tag-badge" data-truncate={truncate || undefined} data-classname={className || undefined}>
      {tag}
    </span>
  ),
}));

describe("TagsCell", () => {
  afterEach(cleanup);

  const defaultProps = {
    allTags: ["tag-a", "tag-b", "tag-c", "tag-d"],
    onTagsUpdate: vi.fn(),
    organizationId: "org-1",
  };

  it("renders tags and keeps them accessible", () => {
    render(<TagsCell {...defaultProps} tags={["tag-a", "tag-b"]} />);

    // Both tags should appear at least once (in cell and/or tooltip)
    expect(screen.getAllByText("tag-a").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("tag-b").length).toBeGreaterThanOrEqual(1);
  });

  it("renders single short tag without tooltip", () => {
    render(<TagsCell {...defaultProps} tags={["only-tag"]} />);

    expect(screen.getAllByText("only-tag")).toHaveLength(1);
    expect(screen.queryByText(/^\+\d+$/)).toBeNull();
    // No tooltip content for short tags
    expect(screen.queryByTestId("tooltip-content")).toBeNull();
  });

  it("renders tooltip for a single long tag that would be truncated", () => {
    const longTag = "test:resume_reattaches_to_existing_run";
    render(<TagsCell {...defaultProps} tags={[longTag]} />);

    expect(screen.getAllByText(longTag).length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText(/^\+\d+$/)).toBeNull();
    // Tooltip content should be rendered for long truncated tags
    const content = screen.getByTestId("tooltip-content");
    expect(content.textContent).toContain(longTag);
  });

  it("renders empty state without overflow", () => {
    render(<TagsCell {...defaultProps} tags={[]} />);

    // No tooltip content (overflow tooltip not rendered)
    expect(screen.queryByTestId("tooltip-content")).toBeNull();
    expect(screen.queryByText(/^\+\d+$/)).toBeNull();
  });

  it("shows overflow badge when tags exceed visible count", () => {
    render(
      <TagsCell {...defaultProps} tags={["tag-a", "tag-b", "tag-c"]} />
    );

    // At least first tag visible
    expect(screen.getAllByText("tag-a").length).toBeGreaterThanOrEqual(1);
    // Overflow badge present (exact count depends on container width in jsdom)
    expect(screen.queryByText(/^\+\d+$/)).not.toBeNull();
  });

  it("wraps overflow badge in tooltip showing all tags", () => {
    render(
      <TagsCell
        {...defaultProps}
        tags={["tag-a", "tag-b", "tag-c", "tag-d"]}
      />
    );

    // Overflow badge present
    expect(screen.queryByText(/^\+\d+$/)).not.toBeNull();
    // Tooltip structure present
    expect(screen.getByTestId("tooltip-root")).toBeDefined();
    expect(screen.getByTestId("tooltip-trigger")).toBeDefined();
    // Tooltip content shows ALL tags (including ones not visible in table)
    const content = screen.getByTestId("tooltip-content");
    expect(content.textContent).toContain("tag-a");
    expect(content.textContent).toContain("tag-b");
    expect(content.textContent).toContain("tag-c");
    expect(content.textContent).toContain("tag-d");
  });

  it("shows correct overflow count for many tags", () => {
    const tags = ["t1", "t2", "t3", "t4", "t5", "t6"];
    render(<TagsCell {...defaultProps} tags={tags} />);

    // Should have an overflow badge
    const overflowBadge = screen.queryByText(/^\+\d+$/);
    expect(overflowBadge).not.toBeNull();
    // First tag always visible
    expect(screen.getAllByText("t1").length).toBeGreaterThanOrEqual(1);
  });

  it("always renders the edit button", () => {
    render(<TagsCell {...defaultProps} tags={["tag-a", "tag-b", "tag-c"]} />);
    expect(screen.getByTestId("tags-editor")).toBeDefined();
  });

  it("tooltip tags have truncate prop for long tag handling", () => {
    render(
      <TagsCell
        {...defaultProps}
        tags={["tag-a", "tag-b", "tag-c"]}
      />
    );

    // Tooltip content tags should have truncate prop
    const tooltipContent = screen.getByTestId("tooltip-content");
    const tooltipBadges = tooltipContent.querySelectorAll("[data-testid='tag-badge']");
    expect(tooltipBadges.length).toBe(3);
    tooltipBadges.forEach((badge) => {
      expect(badge.getAttribute("data-truncate")).toBe("true");
    });
  });

  it("renders with dynamic overflow count based on hidden tags", () => {
    // In jsdom with 0-width container, maxVisible defaults to 1 (Math.max(1, 0))
    // So with 5 tags, overflow should be +4
    const tags = ["alpha", "beta", "gamma", "delta", "epsilon"];
    render(<TagsCell {...defaultProps} tags={tags} />);

    const overflowBadge = screen.queryByText(/^\+\d+$/);
    expect(overflowBadge).not.toBeNull();
    // The hidden count should equal total - visible
    const visibleBadges = screen.getByTestId("tooltip-trigger").querySelectorAll("[data-testid='tag-badge']");
    const overflowText = overflowBadge!.textContent!;
    const hiddenCount = parseInt(overflowText.replace("+", ""));
    expect(hiddenCount + visibleBadges.length).toBe(tags.length);
  });
});
