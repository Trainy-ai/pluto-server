import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { RunTags } from "../run-tags";

// Mock the TagsEditorPopover — it pulls in tRPC / popover internals.
vi.mock("@/components/tags-editor-popover", () => ({
  TagsEditorPopover: ({ trigger }: { trigger: React.ReactNode }) => (
    <div data-testid="tags-editor">{trigger}</div>
  ),
}));

// Mock the tooltip — jsdom doesn't support pointer events / portals. We always
// render the content so tests can assert what would be shown on hover.
vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="tooltip-root">{children}</div>
  ),
  TooltipTrigger: ({
    children,
  }: {
    children: React.ReactNode;
    asChild?: boolean;
  }) => <div data-testid="tooltip-trigger">{children}</div>,
  TooltipContent: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="tooltip-content">{children}</div>
  ),
}));

// Mock TagBadge to render tag text directly.
vi.mock("@/components/tag-badge", () => ({
  TagBadge: ({ tag }: { tag: string }) => (
    <span data-testid="tag-badge">{tag}</span>
  ),
}));

const MAX_VISIBLE_TAGS = 5;

describe("RunTags", () => {
  afterEach(cleanup);

  const defaultProps = {
    onTagsUpdate: vi.fn(),
    organizationId: "org-1",
    projectName: "proj",
  };

  it("shows the empty state when there are no tags", () => {
    render(<RunTags {...defaultProps} tags={[]} />);

    expect(screen.getByText("No tags")).toBeDefined();
    expect(screen.queryByTestId("run-tags-overflow")).toBeNull();
    expect(screen.queryByTestId("tooltip-content")).toBeNull();
  });

  it("renders every tag inline when under the cap (no overflow badge)", () => {
    const tags = ["alpha", "beta", "gamma"];
    render(<RunTags {...defaultProps} tags={tags} />);

    const list = screen.getByTestId("run-tags-list");
    for (const tag of tags) {
      expect(list.textContent).toContain(tag);
    }
    expect(screen.queryByTestId("run-tags-overflow")).toBeNull();
    // Short tags, all visible → no tooltip wrapper at all.
    expect(screen.queryByTestId("tooltip-root")).toBeNull();
    expect(screen.queryByTestId("tooltip-content")).toBeNull();
  });

  it("caps inline tags and shows a +N overflow badge for many tags", () => {
    const tags = Array.from({ length: 12 }, (_, i) => `t${i + 1}`);
    render(<RunTags {...defaultProps} tags={tags} />);

    // Only the first MAX_VISIBLE_TAGS render inline in the list.
    const list = screen.getByTestId("run-tags-list");
    const inlineBadges = list.querySelectorAll('[data-testid="tag-badge"]');
    expect(inlineBadges).toHaveLength(MAX_VISIBLE_TAGS);

    // Overflow badge shows the remaining count.
    expect(screen.getByTestId("run-tags-overflow").textContent).toBe(
      `+${tags.length - MAX_VISIBLE_TAGS}`
    );
  });

  it("lists all tags in the tooltip when overflowing", () => {
    const tags = Array.from({ length: 8 }, (_, i) => `tag-${i}`);
    render(<RunTags {...defaultProps} tags={tags} />);

    const content = screen.getByTestId("tooltip-content");
    for (const tag of tags) {
      expect(content.textContent).toContain(tag);
    }
  });

  it("shows a tooltip for a single long tag that would be truncated", () => {
    const longTag = "experiment:resume_reattaches_to_existing_run_v2";
    render(<RunTags {...defaultProps} tags={[longTag]} />);

    expect(screen.queryByTestId("run-tags-overflow")).toBeNull();
    const content = screen.getByTestId("tooltip-content");
    expect(content.textContent).toContain(longTag);
  });

  it("always renders the edit-tags trigger", () => {
    render(<RunTags {...defaultProps} tags={["a", "b"]} />);
    expect(screen.getByTestId("tags-editor")).toBeDefined();
    expect(screen.getByTestId("run-tags-edit")).toBeDefined();
  });
});
