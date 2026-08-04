/**
 * Tests for the projects DataTable's server-driven summary and empty state.
 *
 * Pagination here is server-side (`manualPagination`), so the table only ever
 * holds one page of rows. That makes two things easy to get wrong, and the
 * projects search bar surfaced both: the "N project(s) total" line must come
 * from the server's count rather than from the rows on screen, and a search
 * with no matches yields zero pages, which must not render as "Page 1 of 0".
 */

import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "../data-table";

afterEach(cleanup);

interface Row {
  name: string;
}

const columns: ColumnDef<Row, unknown>[] = [
  { header: "Name", accessorKey: "name" },
];

const rows: Row[] = [{ name: "alpha" }, { name: "beta" }];

describe("projects DataTable", () => {
  // --- Total count ---

  it("reports the server total rather than the current page's row count", () => {
    // 2 rows on screen, 137 across every page.
    render(
      <DataTable
        columns={columns}
        data={rows}
        pageCount={3}
        pageSize={50}
        totalCount={137}
      />,
    );

    expect(screen.getByText(/137 project\(s\) total/)).toBeDefined();
  });

  it("falls back to the row count when no total is supplied", () => {
    render(<DataTable columns={columns} data={rows} pageCount={1} />);

    expect(screen.getByText(/2 project\(s\) total/)).toBeDefined();
  });

  it("reports zero when a search matched nothing", () => {
    // `totalCount={0}` must not be treated as "not supplied" and fall back.
    render(
      <DataTable columns={columns} data={[]} pageCount={0} totalCount={0} />,
    );

    expect(screen.getByText(/0 project\(s\) total/)).toBeDefined();
  });

  // --- Pager ---

  it("never renders a zero page count", () => {
    render(
      <DataTable columns={columns} data={[]} pageCount={0} totalCount={0} />,
    );

    expect(screen.getByText(/Page 1 of 1/)).toBeDefined();
  });

  it("renders the real page count when there are pages", () => {
    render(
      <DataTable
        columns={columns}
        data={rows}
        pageCount={3}
        pageIndex={1}
        pageSize={50}
        totalCount={137}
      />,
    );

    expect(screen.getByText(/Page 2 of 3/)).toBeDefined();
  });

  // --- Empty state ---

  it("shows the default empty message", () => {
    render(<DataTable columns={columns} data={[]} pageCount={0} />);

    expect(screen.getByText("No projects found.")).toBeDefined();
  });

  it("shows a caller-supplied empty message explaining the search", () => {
    render(
      <DataTable
        columns={columns}
        data={[]}
        pageCount={0}
        emptyMessage={'No projects match "vision".'}
      />,
    );

    expect(screen.getByText('No projects match "vision".')).toBeDefined();
    expect(screen.queryByText("No projects found.")).toBeNull();
  });

  it("prefers the loading spinner over the empty message while fetching", () => {
    // Otherwise the first paint of a search claims "no matches" before the
    // request has come back.
    render(
      <DataTable
        columns={columns}
        data={[]}
        pageCount={0}
        isLoading
        emptyMessage={'No projects match "vision".'}
      />,
    );

    expect(screen.queryByText('No projects match "vision".')).toBeNull();
    // Tagged so tests can tell "still fetching" apart from "nothing matched" —
    // both render zero rows, and reading rows during the former is a race.
    expect(screen.getByTestId("projects-table-loading")).toBeDefined();
  });

  it("drops the loading marker once rows arrive", () => {
    render(<DataTable columns={columns} data={rows} pageCount={1} />);

    expect(screen.queryByTestId("projects-table-loading")).toBeNull();
  });

  it("renders rows when there are matches", () => {
    render(<DataTable columns={columns} data={rows} pageCount={1} />);

    expect(screen.getByText("alpha")).toBeDefined();
    expect(screen.getByText("beta")).toBeDefined();
    expect(screen.queryByText("No projects found.")).toBeNull();
  });
});
