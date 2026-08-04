/**
 * Tests for the projects table's sortable column headers.
 *
 * Sorting is server-side, so the table's job is narrow but easy to break: report
 * the active sort, and emit the right next state when a header is clicked. The
 * risks worth pinning down are the toggle cycle (asc → desc → unsorted, so a
 * third click restores the default order), the first-click direction (TanStack
 * infers it from row data, which is undefined for the run-derived columns), and
 * that non-sortable columns stay inert.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import type { ColumnDef, SortingState } from "@tanstack/react-table";
import { DataTable } from "../data-table";
import { SortableHeader } from "../sortable-header";

afterEach(cleanup);

interface Row {
  name: string;
  lastRunAt: Date | null;
}

const rows: Row[] = [
  { name: "alpha", lastRunAt: new Date("2026-01-01") },
  { name: "beta", lastRunAt: null },
];

const columns: ColumnDef<Row, unknown>[] = [
  {
    id: "name",
    accessorKey: "name",
    sortDescFirst: false,
    header: ({ column }) => <SortableHeader column={column} label="Name" />,
  },
  {
    id: "lastRunAt",
    // Mirrors the real column: sortable only because it has an accessor.
    accessorFn: (row: Row) => row.lastRunAt,
    sortDescFirst: true,
    header: ({ column }) => (
      <SortableHeader column={column} label="Last Run At" />
    ),
    cell: () => null,
  },
  {
    id: "actions",
    header: "",
    enableSorting: false,
    cell: () => null,
  },
];

/**
 * Renders the table and returns the sorting state produced by a click.
 * `onSortingChange` receives an updater, so resolve it against the state the
 * table was rendered with.
 */
function clickHeaderForSorting(
  testId: string,
  sorting: SortingState = [],
): SortingState {
  const onSortingChange = vi.fn();
  render(
    <DataTable
      columns={columns}
      data={rows}
      pageCount={1}
      sorting={sorting}
      onSortingChange={onSortingChange}
    />,
  );

  fireEvent.click(screen.getByTestId(testId));

  expect(onSortingChange).toHaveBeenCalledTimes(1);
  const updater = onSortingChange.mock.calls[0][0];
  return typeof updater === "function" ? updater(sorting) : updater;
}

describe("projects table sorting", () => {
  // --- Rendering ---

  it("renders sortable columns as buttons", () => {
    render(<DataTable columns={columns} data={rows} pageCount={1} />);

    expect(screen.getByTestId("projects-sort-name").tagName).toBe("BUTTON");
    expect(screen.getByTestId("projects-sort-lastRunAt").tagName).toBe(
      "BUTTON",
    );
  });

  it("leaves non-sortable columns without a sort control", () => {
    render(<DataTable columns={columns} data={rows} pageCount={1} />);

    expect(screen.queryByTestId("projects-sort-actions")).toBeNull();
  });

  // --- aria-sort ---

  it("announces the active sort on the header cell", () => {
    render(
      <DataTable
        columns={columns}
        data={rows}
        pageCount={1}
        sorting={[{ id: "name", desc: false }]}
      />,
    );

    const headers = screen.getAllByRole("columnheader");
    const nameHeader = headers.find((h) => h.textContent?.includes("Name"));
    expect(nameHeader?.getAttribute("aria-sort")).toBe("ascending");
  });

  it("announces descending when sorted the other way", () => {
    render(
      <DataTable
        columns={columns}
        data={rows}
        pageCount={1}
        sorting={[{ id: "name", desc: true }]}
      />,
    );

    const headers = screen.getAllByRole("columnheader");
    const nameHeader = headers.find((h) => h.textContent?.includes("Name"));
    expect(nameHeader?.getAttribute("aria-sort")).toBe("descending");
  });

  it("marks unsorted sortable columns as sortable, not absent", () => {
    render(<DataTable columns={columns} data={rows} pageCount={1} />);

    const headers = screen.getAllByRole("columnheader");
    const nameHeader = headers.find((h) => h.textContent?.includes("Name"));
    expect(nameHeader?.getAttribute("aria-sort")).toBe("none");
  });

  it("omits aria-sort entirely on non-sortable columns", () => {
    render(<DataTable columns={columns} data={rows} pageCount={1} />);

    const headers = screen.getAllByRole("columnheader");
    const actionsHeader = headers[headers.length - 1];
    expect(actionsHeader.hasAttribute("aria-sort")).toBe(false);
  });

  // --- Toggle cycle ---

  it("sorts a text column ascending on first click", () => {
    expect(clickHeaderForSorting("projects-sort-name")).toEqual([
      { id: "name", desc: false },
    ]);
  });

  it("sorts a date column descending on first click", () => {
    // Newest runs first is the useful default, and this column has no accessor
    // for TanStack to infer a direction from.
    expect(clickHeaderForSorting("projects-sort-lastRunAt")).toEqual([
      { id: "lastRunAt", desc: true },
    ]);
  });

  it("reverses direction on the second click", () => {
    expect(
      clickHeaderForSorting("projects-sort-name", [
        { id: "name", desc: false },
      ]),
    ).toEqual([{ id: "name", desc: true }]);
  });

  it("clears the sort on the third click", () => {
    // Returning to no sort is how the user gets back to the server's default
    // ordering without reloading the page.
    expect(
      clickHeaderForSorting("projects-sort-name", [{ id: "name", desc: true }]),
    ).toEqual([]);
  });

  it("replaces the sort rather than stacking when another column is clicked", () => {
    // The server orders by a single column; a second entry would be ignored,
    // leaving the header indicator disagreeing with the rows.
    const next = clickHeaderForSorting("projects-sort-lastRunAt", [
      { id: "name", desc: false },
    ]);

    expect(next).toEqual([{ id: "lastRunAt", desc: true }]);
  });

  it("does not emit a sort change for non-sortable columns", () => {
    const onSortingChange = vi.fn();
    render(
      <DataTable
        columns={columns}
        data={rows}
        pageCount={1}
        sorting={[]}
        onSortingChange={onSortingChange}
      />,
    );

    const headers = screen.getAllByRole("columnheader");
    fireEvent.click(headers[headers.length - 1]);

    expect(onSortingChange).not.toHaveBeenCalled();
  });

  // --- Server-side ordering ---

  it("keeps the server's row order regardless of the active sort", () => {
    // manualSorting: the rows arrive already ordered. If the table re-sorted
    // them it would only reorder the current page.
    render(
      <DataTable
        columns={columns}
        data={rows}
        pageCount={1}
        sorting={[{ id: "name", desc: true }]}
      />,
    );

    const cells = screen.getAllByRole("cell");
    expect(cells[0].textContent).toBe("alpha");
  });
});
