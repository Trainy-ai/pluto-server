import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

// Radix dropdown uses portals/pointer events jsdom can't drive — render every
// menu item inline and forward onClick/onSelect so we can assert behaviour.
vi.mock("@/components/ui/dropdown-menu", () => {
  const Pass = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
  return {
    DropdownMenu: Pass,
    DropdownMenuTrigger: ({ children }: { children?: React.ReactNode }) => (
      <div>{children}</div>
    ),
    DropdownMenuContent: Pass,
    DropdownMenuLabel: Pass,
    DropdownMenuSeparator: () => null,
    DropdownMenuCheckboxItem: ({
      children,
      onSelect,
      checked,
      ...rest
    }: {
      children?: React.ReactNode;
      onSelect?: (e: { preventDefault: () => void }) => void;
      checked?: boolean;
    } & Record<string, unknown>) => (
      <div
        {...rest}
        data-checked={checked ? "true" : "false"}
        onClick={() => onSelect?.({ preventDefault() {} })}
      >
        {children}
      </div>
    ),
    DropdownMenuItem: ({
      children,
      onClick,
      onSelect,
      ...rest
    }: {
      children?: React.ReactNode;
      onClick?: (e: unknown) => void;
      onSelect?: (e: { preventDefault: () => void }) => void;
    } & Record<string, unknown>) => (
      <div
        {...rest}
        onClick={(e) => {
          onClick?.(e);
          onSelect?.({ preventDefault() {} });
        }}
      >
        {children}
      </div>
    ),
  };
});

import { StatusColumnHeader } from "../status-column-header";

const baseProps = {
  label: "Status",
  sortDirection: false as const,
  onSort: vi.fn(),
  statusValues: [] as string[],
  onStatusChange: vi.fn(),
};

describe("StatusColumnHeader", () => {
  afterEach(cleanup);

  it("adds a state to the filter when an option is toggled on", () => {
    const onStatusChange = vi.fn();
    render(<StatusColumnHeader {...baseProps} onStatusChange={onStatusChange} />);
    fireEvent.click(screen.getByTestId("status-filter-FAILED"));
    expect(onStatusChange).toHaveBeenCalledWith(["FAILED"]);
  });

  it("removes only the toggled-off state, keeping the rest", () => {
    const onStatusChange = vi.fn();
    render(
      <StatusColumnHeader
        {...baseProps}
        statusValues={["FAILED", "TERMINATED"]}
        onStatusChange={onStatusChange}
      />,
    );
    fireEvent.click(screen.getByTestId("status-filter-FAILED"));
    expect(onStatusChange).toHaveBeenCalledWith(["TERMINATED"]);
  });

  it("triggers an ascending sort from the menu", () => {
    const onSort = vi.fn();
    render(<StatusColumnHeader {...baseProps} onSort={onSort} />);
    fireEvent.click(screen.getByText("Sort ascending"));
    expect(onSort).toHaveBeenCalledWith("asc");
  });

  it("marks the trigger active and clears all states from one action", () => {
    const onStatusChange = vi.fn();
    render(
      <StatusColumnHeader
        {...baseProps}
        statusValues={["FAILED"]}
        onStatusChange={onStatusChange}
      />,
    );
    expect(screen.getByTestId("status-header-trigger").className).toContain(
      "text-primary",
    );
    fireEvent.click(screen.getByText("Clear filter"));
    expect(onStatusChange).toHaveBeenCalledWith([]);
  });
});
