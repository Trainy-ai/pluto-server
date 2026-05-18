import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { SearchOtherMatchesDropdown } from "../components/search-other-matches-dropdown";
import type { Run } from "../../../~queries/list-runs";

afterEach(cleanup);

function makeRun(id: string, name = `run-${id}`): Run {
  return {
    id,
    name,
    displayId: `TES-${id}`,
    status: "COMPLETED",
    createdAt: "2026-02-22T12:34:56Z",
  } as unknown as Run;
}

const defaultProps = {
  outOfView: [] as Run[],
  inView: [] as Run[],
  hasMore: false,
  isLoading: false,
  selectedRunsWithColors: {},
  onSelectRun: vi.fn(),
  onDismiss: vi.fn(),
};

describe("SearchOtherMatchesDropdown", () => {
  it("renders nothing when there are no out-of-view matches", () => {
    const { container } = render(<SearchOtherMatchesDropdown {...defaultProps} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders out-of-view rows as clickable", () => {
    const run = makeRun("A");
    render(<SearchOtherMatchesDropdown {...defaultProps} outOfView={[run]} />);
    const row = screen.getByTestId(`other-match-row-${run.id}`);
    expect(row.getAttribute("aria-disabled")).not.toBe("true");
  });

  it("renders in-view rows grayed with 'In table' badge", () => {
    const inViewRun = makeRun("A");
    const outRun = makeRun("B");
    render(
      <SearchOtherMatchesDropdown
        {...defaultProps}
        outOfView={[outRun]}
        inView={[inViewRun]}
      />,
    );
    const row = screen.getByTestId(`other-match-row-${inViewRun.id}`);
    expect(row.getAttribute("aria-disabled")).toBe("true");
    expect(row.textContent).toMatch(/in table/i);
  });

  it("clicking out-of-view row calls onSelectRun with the run", () => {
    const onSelectRun = vi.fn();
    const run = makeRun("A");
    render(
      <SearchOtherMatchesDropdown
        {...defaultProps}
        outOfView={[run]}
        onSelectRun={onSelectRun}
      />,
    );
    fireEvent.click(screen.getByTestId(`other-match-row-${run.id}`));
    expect(onSelectRun).toHaveBeenCalledWith(run);
  });

  it("clicking in-view row does not call onSelectRun", () => {
    const onSelectRun = vi.fn();
    const inViewRun = makeRun("A");
    const outRun = makeRun("B");
    render(
      <SearchOtherMatchesDropdown
        {...defaultProps}
        outOfView={[outRun]}
        inView={[inViewRun]}
        onSelectRun={onSelectRun}
      />,
    );
    fireEvent.click(screen.getByTestId(`other-match-row-${inViewRun.id}`));
    expect(onSelectRun).not.toHaveBeenCalled();
  });

  it("clicking out-of-view row does NOT call onDismiss", () => {
    const onDismiss = vi.fn();
    const run = makeRun("A");
    render(
      <SearchOtherMatchesDropdown
        {...defaultProps}
        outOfView={[run]}
        onDismiss={onDismiss}
      />,
    );
    fireEvent.click(screen.getByTestId(`other-match-row-${run.id}`));
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("Esc key calls onDismiss", () => {
    const onDismiss = vi.fn();
    const run = makeRun("A");
    render(
      <SearchOtherMatchesDropdown
        {...defaultProps}
        outOfView={[run]}
        onDismiss={onDismiss}
      />,
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onDismiss).toHaveBeenCalled();
  });

  it("shows 'refine your search' footer when hasMore is true", () => {
    const rows = Array.from({ length: 30 }, (_, i) => makeRun(`r${i}`));
    render(
      <SearchOtherMatchesDropdown
        {...defaultProps}
        outOfView={rows}
        hasMore={true}
      />,
    );
    expect(screen.getByText(/refine your search/i)).toBeDefined();
  });

  it("does NOT show footer when hasMore is false", () => {
    const rows = Array.from({ length: 5 }, (_, i) => makeRun(`r${i}`));
    render(
      <SearchOtherMatchesDropdown
        {...defaultProps}
        outOfView={rows}
        hasMore={false}
      />,
    );
    expect(screen.queryByText(/refine your search/i)).toBeNull();
  });

  it("shows a Loading indicator when isLoading=true and no rows yet", () => {
    render(<SearchOtherMatchesDropdown {...defaultProps} isLoading={true} />);
    expect(screen.getByText(/loading/i)).toBeDefined();
  });

  it("calls onDismiss when a click lands outside the search wrapper", () => {
    const onDismiss = vi.fn();
    const run = makeRun("A");

    // Mount the dropdown inside a wrapper that mimics the toolbar's
    // `<div className="relative flex-1">` (the parent in the real DOM
    // contains both the search input and the dropdown). Clicks inside
    // the wrapper should not dismiss; clicks outside should.
    const { container } = render(
      <div>
        <div data-testid="search-wrapper" className="relative">
          <input data-testid="search-input" />
          <SearchOtherMatchesDropdown
            {...defaultProps}
            outOfView={[run]}
            onDismiss={onDismiss}
          />
        </div>
        <div data-testid="outside-target">outside</div>
      </div>,
    );

    // Click on the search input itself — inside the wrapper, must NOT dismiss
    fireEvent.mouseDown(
      container.querySelector('[data-testid="search-input"]')!,
    );
    expect(onDismiss).not.toHaveBeenCalled();

    // Click on a dropdown row — inside the wrapper, must NOT dismiss
    fireEvent.mouseDown(screen.getByTestId(`other-match-row-${run.id}`));
    expect(onDismiss).not.toHaveBeenCalled();

    // Click outside the wrapper — must dismiss
    fireEvent.mouseDown(screen.getByTestId("outside-target"));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
