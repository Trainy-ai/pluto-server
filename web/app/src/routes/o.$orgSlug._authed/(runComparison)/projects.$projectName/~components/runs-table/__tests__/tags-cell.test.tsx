import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";
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
  TagBadge: ({ tag, truncate, className }: { tag: string; truncate?: boolean; className?: string }) => (
    <span data-testid="tag-badge" data-truncate={truncate || undefined} data-classname={className || undefined}>
      {tag}
    </span>
  ),
}));

// ── ResizeObserver stub ──────────────────────────────────────────────
// jsdom doesn't provide ResizeObserver. We store the last callback so tests
// can trigger measurement with a controlled container width.

let resizeCallback: ResizeObserverCallback | null = null;

class FakeResizeObserver {
  constructor(cb: ResizeObserverCallback) {
    resizeCallback = cb;
  }
  observe() {}
  unobserve() {}
  disconnect() {
    resizeCallback = null;
  }
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
});

afterEach(() => {
  resizeCallback = null;
  vi.restoreAllMocks();
});

/**
 * Helper: simulate a ResizeObserver callback that makes the measurement
 * logic see a specific container `clientWidth`.  Because jsdom elements
 * always report 0 for `clientWidth`/`offsetWidth`, we need to stub the
 * element properties that the measurement code reads.
 *
 * `tagWidths` lets us control the per-tag `offsetWidth` returned by the
 * hidden measurement row children.
 */
function simulateResize(
  containerWidth: number,
  tagWidths: number[]
) {
  if (!resizeCallback) return;

  // The component's outerRef is the first `div.relative` rendered.
  // Its `clientWidth` is read inside `measure()`.
  const outerDiv = document.querySelector<HTMLElement>("[data-testid='tooltip-root']")?.closest<HTMLElement>("div.relative");
  if (!outerDiv) return;

  // Stub clientWidth on the outer container
  Object.defineProperty(outerDiv, "clientWidth", { value: containerWidth, configurable: true });

  // The hidden measurement div is the first child with aria-hidden
  const measureDiv = outerDiv.querySelector<HTMLElement>('[aria-hidden="true"]');
  if (measureDiv) {
    const children = Array.from(measureDiv.children) as HTMLElement[];
    children.forEach((child, i) => {
      Object.defineProperty(child, "offsetWidth", {
        value: tagWidths[i] ?? 50,
        configurable: true,
      });
    });
  }

  act(() => {
    resizeCallback!([], {} as ResizeObserver);
  });
}

describe("TagsCell", () => {
  afterEach(cleanup);

  const defaultProps = {
    allTags: ["tag-a", "tag-b", "tag-c", "tag-d"],
    onTagsUpdate: vi.fn(),
    organizationId: "org-1",
  };

  // ── Basic rendering (initial state: visibleCount = 1 to avoid flicker) ──

  it("renders tags and keeps them accessible", () => {
    render(<TagsCell {...defaultProps} tags={["tag-a", "tag-b"]} />);

    // Both tags should appear at least once (in measurement row and/or visible area)
    expect(screen.getAllByText("tag-a").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("tag-b").length).toBeGreaterThanOrEqual(1);
  });

  it("renders single short tag without tooltip", () => {
    render(<TagsCell {...defaultProps} tags={["only-tag"]} />);

    expect(screen.getAllByText("only-tag")).toHaveLength(2); // 1 measure + 1 visible
    expect(screen.queryByText(/^\+\d+$/)).toBeNull();
    expect(screen.queryByTestId("tooltip-content")).toBeNull();
  });

  it("renders tooltip for a single long tag that would be truncated", () => {
    const longTag = "test:resume_reattaches_to_existing_run";
    render(<TagsCell {...defaultProps} tags={[longTag]} />);

    expect(screen.getAllByText(longTag).length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText(/^\+\d+$/)).toBeNull();
    const content = screen.getByTestId("tooltip-content");
    expect(content.textContent).toContain(longTag);
  });

  it("renders empty state without overflow", () => {
    render(<TagsCell {...defaultProps} tags={[]} />);

    expect(screen.queryByTestId("tooltip-content")).toBeNull();
    expect(screen.queryByText(/^\+\d+$/)).toBeNull();
  });

  // ── Hidden measurement row ──

  it("renders a hidden measurement row with all tags", () => {
    const tags = ["tag-a", "tag-b", "tag-c", "tag-d"];
    render(<TagsCell {...defaultProps} tags={tags} />);

    const measureRow = document.querySelector('[aria-hidden="true"]');
    expect(measureRow).not.toBeNull();
    // Measurement row contains all tags (one TagBadge per tag)
    const measureBadges = measureRow!.querySelectorAll('[data-testid="tag-badge"]');
    expect(measureBadges).toHaveLength(tags.length);
  });

  // ── Dynamic visibility via ResizeObserver ──

  it("shows overflow badge when container is too narrow for all tags", () => {
    const tags = ["tag-a", "tag-b", "tag-c", "tag-d"];
    render(<TagsCell {...defaultProps} tags={tags} />);

    // Simulate a narrow container (only fits 2 tags)
    // Each tag ~50px, gap 4px, overflow badge 36px, edit button 28px
    // Available = 200 - 28 = 172. Two tags: 50 + 4 + 50 + 4 + 36 = 144 fits, three: 50+4+50+4+50+4+36=198 > 172
    simulateResize(200, [50, 50, 50, 50]);

    // Should show +2 overflow badge
    expect(screen.getByText("+2")).toBeDefined();
    // Tooltip content should show all tags
    const content = screen.getByTestId("tooltip-content");
    expect(content.textContent).toContain("tag-a");
    expect(content.textContent).toContain("tag-d");
  });

  it("shows all tags (no overflow) when container is wide enough", () => {
    const tags = ["tag-a", "tag-b", "tag-c"];
    render(<TagsCell {...defaultProps} tags={tags} />);

    // Wide container: 500 - 28 = 472 available, 3 tags @ 50px each = 158px total, easily fits
    simulateResize(500, [50, 50, 50]);

    // No overflow badge
    expect(screen.queryByText(/^\+\d+$/)).toBeNull();
    // No tooltip (tags are short and all visible)
    expect(screen.queryByTestId("tooltip-content")).toBeNull();
  });

  it("updates visible count when container resizes wider", () => {
    const tags = ["t1", "t2", "t3", "t4", "t5", "t6"];
    render(<TagsCell {...defaultProps} tags={tags} />);

    // Start narrow — only 2 fit
    simulateResize(200, [50, 50, 50, 50, 50, 50]);
    expect(screen.getByText("+4")).toBeDefined();

    // Resize wider — now 4 fit
    simulateResize(300, [50, 50, 50, 50, 50, 50]);
    expect(screen.getByText("+2")).toBeDefined();
  });

  it("always shows at least 1 tag even in very narrow container", () => {
    const tags = ["tag-a", "tag-b"];
    render(<TagsCell {...defaultProps} tags={tags} />);

    // Extremely narrow — nothing really fits, but we clamp to 1
    simulateResize(30, [50, 50]);

    // Should still show 1 visible tag badge in the visible area
    const visibleBadges = screen.getAllByText("tag-a");
    expect(visibleBadges.length).toBeGreaterThanOrEqual(1);
  });

  it("shows correct overflow count for many tags in narrow cell", () => {
    const tags = ["t1", "t2", "t3", "t4", "t5", "t6"];
    render(<TagsCell {...defaultProps} tags={tags} />);

    // Narrow: only 1 fits
    simulateResize(100, [50, 50, 50, 50, 50, 50]);

    expect(screen.getByText("+5")).toBeDefined();
  });

  // ── Tooltip content always shows all tags ──

  it("tooltip content includes all tags regardless of visible count", () => {
    const tags = ["alpha", "beta", "gamma", "delta", "epsilon"];
    render(<TagsCell {...defaultProps} tags={tags} />);

    // Narrow container
    simulateResize(200, [60, 60, 60, 60, 60]);

    const content = screen.getByTestId("tooltip-content");
    for (const tag of tags) {
      expect(content.textContent).toContain(tag);
    }
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

  it("always renders the edit button", () => {
    render(<TagsCell {...defaultProps} tags={["tag-a", "tag-b", "tag-c"]} />);
    expect(screen.getByTestId("tags-editor")).toBeDefined();
  });
});
