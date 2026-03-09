import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { TagsCell } from "../tags-cell";

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
  TagBadge: ({ tag }: { tag: string; truncate?: boolean }) => (
    <span data-testid="tag-badge">{tag}</span>
  ),
}));

describe("TagsCell", () => {
  afterEach(cleanup);

  const defaultProps = {
    allTags: ["tag-a", "tag-b", "tag-c", "tag-d"],
    onTagsUpdate: vi.fn(),
    organizationId: "org-1",
  };

  it("renders all tags when 2 or fewer", () => {
    render(<TagsCell {...defaultProps} tags={["tag-a", "tag-b"]} />);

    expect(screen.getAllByText("tag-a")).toHaveLength(1);
    expect(screen.getAllByText("tag-b")).toHaveLength(1);
    // No overflow badge
    expect(screen.queryByText(/^\+\d+$/)).toBeNull();
    // No tooltip content (overflow tooltip not rendered)
    expect(screen.queryByTestId("tooltip-content")).toBeNull();
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

  it("shows first 2 tags and +N badge when more than 2 tags", () => {
    render(
      <TagsCell {...defaultProps} tags={["tag-a", "tag-b", "tag-c"]} />
    );

    // First 2 visible in table + all 3 in tooltip content
    expect(screen.getAllByText("tag-a").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("tag-b").length).toBeGreaterThanOrEqual(1);
    // Overflow badge
    expect(screen.getByText("+1")).toBeDefined();
  });

  it("wraps overflow badge in tooltip showing all tags", () => {
    render(
      <TagsCell
        {...defaultProps}
        tags={["tag-a", "tag-b", "tag-c", "tag-d"]}
      />
    );

    // Overflow badge
    expect(screen.getByText("+2")).toBeDefined();
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

    expect(screen.getByText("+4")).toBeDefined();
    // First 2 visible
    expect(screen.getAllByText("t1").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("t2").length).toBeGreaterThanOrEqual(1);
  });

  it("always renders the edit button", () => {
    render(<TagsCell {...defaultProps} tags={["tag-a", "tag-b", "tag-c"]} />);
    expect(screen.getByTestId("tags-editor")).toBeDefined();
  });
});
