import { useQuery } from "@tanstack/react-query";
import { useMemo, useState, useRef, useEffect, useCallback } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { LogGroup } from "@/lib/grouping/types";
import { trpc } from "@/utils/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ChevronLeft,
  ChevronRight,
  Search,
  ChevronDown,
  ChevronUp,
  X,
  ArrowUpDown,
  Filter,
  FileSpreadsheet,
  Copy,
} from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";

// ==============================
// Types
// ==============================

interface TableViewProps {
  log: LogGroup["logs"][number];
  tenantId: string;
  projectName: string;
  runId: string;
}

interface TableData {
  table: Array<Array<string | number>>;
  row?: Array<{
    name: string;
    dtype: "int" | "float" | "str";
  }>;
  col?: Array<{
    name: string;
    dtype: "int" | "float" | "str";
  }>;
}

interface TableResponse {
  logName: string;
  time: Date;
  step: number;
  tableData: TableData;
}

interface SortState {
  column: number;
  direction: "asc" | "desc";
}

interface FilterState {
  id: string;
  column: number;
  value: string;
  operator: string;
}

interface CellModalState {
  isOpen: boolean;
  content: string | number | null;
  title: string;
  isJson: boolean;
}

// ==============================
// Constants
// ==============================

/** Available page size options for the table */
const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];

/** Available filter operators for numeric columns */
const NUMERIC_OPERATORS = ["=", ">", ">=", "<", "<=", "!="];

// ==============================
// Utility Functions
// ==============================

/**
 * Checks if a string is valid JSON
 * @param str The string to check
 * @returns True if the string is valid JSON, false otherwise
 */
const isJsonString = (str: string): boolean => {
  if (typeof str !== "string") return false;
  if (str.trim().length === 0) return false;

  try {
    const firstChar = str.trim()[0];
    // Only attempt to parse if it starts with { or [
    if (firstChar === "{" || firstChar === "[") {
      JSON.parse(str);
      return true;
    }
    return false;
  } catch (e) {
    return false;
  }
};

/**
 * Formats a JSON string with indentation
 * @param jsonString The JSON string to format
 * @returns The formatted JSON string with indentation
 */
const formatJson = (jsonString: string): string => {
  try {
    return JSON.stringify(JSON.parse(jsonString), null, 2);
  } catch (e) {
    return jsonString;
  }
};

/**
 * Generates a unique ID for filters
 * @returns A unique string ID
 */
const generateFilterId = () =>
  `filter_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

/**
 * Creates a preview of JSON content
 * @param jsonString The JSON string to create a preview from
 * @returns A simplified preview string of the JSON content
 */
const createJsonPreview = (jsonString: string): string => {
  try {
    const parsed = JSON.parse(jsonString);
    if (Array.isArray(parsed)) {
      // For arrays, show length and first few values
      const length = parsed.length;
      const preview = parsed
        .slice(0, 2)
        .map((val: any) => {
          if (typeof val === "object" && val !== null) {
            return typeof val === "object" && Array.isArray(val)
              ? "[...]"
              : "{...}";
          }
          return (
            String(val).substring(0, 15) +
            (String(val).length > 15 ? "..." : "")
          );
        })
        .join(", ");

      return `[${preview}${length > 2 ? `, ... (${length} items)` : ""}]`;
    } else if (typeof parsed === "object" && parsed !== null) {
      // For objects, show first few keys and values
      const keys = Object.keys(parsed);
      const preview = keys
        .slice(0, 2)
        .map((key) => {
          const val = parsed[key];
          let valPreview = "";

          if (typeof val === "object" && val !== null) {
            valPreview = Array.isArray(val) ? "[...]" : "{...}";
          } else {
            valPreview =
              String(val).substring(0, 10) +
              (String(val).length > 10 ? "..." : "");
          }

          return `${key}: ${valPreview}`;
        })
        .join(", ");

      return `{${preview}${keys.length > 2 ? ", ..." : ""}}`;
    }
    // Fallback for simple values
    return (
      String(parsed).substring(0, 30) +
      (String(parsed).length > 30 ? "..." : "")
    );
  } catch (e) {
    return "{...}"; // Fallback if parsing fails
  }
};

// ==============================
// Custom Hooks
// ==============================

/**
 * Hook for managing filter state and operations
 */
function useTableFilters() {
  const [filterState, setFilterState] = useState<FilterState[]>([]);
  const [searchValue, setSearchValue] = useState("");
  const [activeFilters, setActiveFilters] = useState<number>(0);
  const [filterUIState, setFilterUIState] = useState<{
    mode: "columns" | "conditions";
    selectedColumn: number | null;
  }>({
    mode: "columns",
    selectedColumn: null,
  });

  // Update active filters count when filter state changes
  useEffect(() => {
    setActiveFilters(filterState.length + (searchValue ? 1 : 0));
  }, [filterState.length, searchValue]);

  // Apply a filter to a column
  const applyFilter = useCallback(
    (
      columnIndex: number,
      value: string,
      operator: string = "=",
      filterId?: string,
    ) => {
      setFilterState((prev) => {
        const trimmedValue = value.trim();

        // If we have a filter ID, update that specific filter
        if (filterId) {
          if (!trimmedValue) {
            // Remove filter if value is empty
            return prev.filter((f) => f.id !== filterId);
          }

          // Update existing filter with ID
          return prev.map((f) =>
            f.id === filterId ? { ...f, value: trimmedValue } : f,
          );
        }

        // If no filter ID provided, look for a filter with matching column and operator
        const existingFilter = prev.find(
          (f) => f.column === columnIndex && f.operator === operator,
        );

        if (existingFilter) {
          if (!trimmedValue) {
            // Remove filter if value is empty
            return prev.filter((f) => f.id !== existingFilter.id);
          }

          // Update existing filter
          return prev.map((f) =>
            f.id === existingFilter.id ? { ...f, value: trimmedValue } : f,
          );
        } else {
          // No existing filter found, create a new one if value is not empty
          if (!trimmedValue) return prev;

          return [
            ...prev,
            {
              id: generateFilterId(),
              column: columnIndex,
              value: trimmedValue,
              operator,
            },
          ];
        }
      });
    },
    [],
  );

  // Change a filter's operator
  const changeFilterOperator = useCallback(
    (filterId: string, newOperator: string) => {
      setFilterState((prev) => {
        const filter = prev.find((f) => f.id === filterId);
        if (!filter) return prev;

        return prev.map((f) =>
          f.id === filterId ? { ...f, operator: newOperator } : f,
        );
      });
    },
    [],
  );

  // Add a new filter condition
  const addFilterCondition = useCallback(
    (columnIndex: number, operator: string = "=") => {
      setFilterState((prev) => {
        return [
          ...prev,
          {
            id: generateFilterId(),
            column: columnIndex,
            value: "",
            operator,
          },
        ];
      });
    },
    [],
  );

  // Remove a specific filter
  const removeFilter = useCallback((filterId: string) => {
    setFilterState((prev) => prev.filter((f) => f.id !== filterId));
  }, []);

  // Clear all filters for a column
  const clearColumnFilters = useCallback((columnIndex: number) => {
    setFilterState((prev) => prev.filter((f) => f.column !== columnIndex));
  }, []);

  // Clear all filters
  const clearAllFilters = useCallback(() => {
    setFilterState([]);
    setSearchValue("");
  }, []);

  // Check if a column has any filters
  const hasFilter = useCallback(
    (columnIndex: number) => {
      return filterState.some((f) => f.column === columnIndex);
    },
    [filterState],
  );

  // Get the filters for a column
  const getColumnFilters = useCallback(
    (columnIndex: number) => {
      return filterState.filter((f) => f.column === columnIndex);
    },
    [filterState],
  );

  // Get all operators used for a column
  const getColumnOperators = useCallback(
    (columnIndex: number) => {
      return filterState
        .filter((f) => f.column === columnIndex)
        .map((f) => f.operator);
    },
    [filterState],
  );

  // Get a filter value by ID
  const getFilterValue = useCallback(
    (filterId: string) => {
      const filter = filterState.find((f) => f.id === filterId);
      return filter ? filter.value : "";
    },
    [filterState],
  );

  return {
    filterState,
    searchValue,
    setSearchValue,
    activeFilters,
    filterUIState,
    setFilterUIState,
    applyFilter,
    changeFilterOperator,
    addFilterCondition,
    removeFilter,
    clearColumnFilters,
    clearAllFilters,
    hasFilter,
    getColumnFilters,
    getColumnOperators,
    getFilterValue,
  };
}

/**
 * Hook for managing pagination state
 */
function usePagination(totalItems: number) {
  const [state, setState] = useState({
    currentPage: 0,
    itemsPerPage: 25,
  });

  // Total pages calculation - memoized to prevent recalculation
  const totalPages = useMemo(() => {
    return Math.ceil(totalItems / state.itemsPerPage) || 1;
  }, [totalItems, state.itemsPerPage]);

  // Go to a specific page
  const goToPage = useCallback(
    (page: number) => {
      setState((prev) => ({
        ...prev,
        currentPage: Math.max(0, Math.min(page, totalPages - 1)),
      }));
    },
    [totalPages],
  );

  // Change the number of items per page
  const changePageSize = useCallback((size: number) => {
    setState((prev) => {
      const newItemsPerPage = Number(size);
      // Calculate the first item index to maintain position
      const firstItemIndex = prev.currentPage * prev.itemsPerPage;
      // Calculate the new page that would contain this item
      const newPage = Math.floor(firstItemIndex / newItemsPerPage);

      return {
        currentPage: newPage,
        itemsPerPage: newItemsPerPage,
      };
    });
  }, []);

  return {
    currentPage: state.currentPage,
    itemsPerPage: state.itemsPerPage,
    totalPages,
    goToPage,
    changePageSize,
  };
}

/**
 * Hook for managing cell content modal
 */
function useCellModal() {
  const [cellModal, setCellModal] = useState<CellModalState>({
    isOpen: false,
    content: null,
    title: "",
    isJson: false,
  });

  // Handle cell double click
  const handleCellDoubleClick = useCallback(
    (content: string | number, columnName: string) => {
      let isJson = false;
      let formattedContent = String(content);

      // Check if content is long enough to warrant a modal
      const stringContent = String(content);
      if (stringContent.length < 50 && !isJsonString(stringContent)) {
        return; // Don't open modal for short content
      }

      // Check if it's JSON and format it
      if (typeof content === "string" && isJsonString(content)) {
        formattedContent = formatJson(content);
        isJson = true;
      }

      setCellModal({
        isOpen: true,
        content: formattedContent,
        title: columnName,
        isJson,
      });
    },
    [],
  );

  // Copy content to clipboard
  const copyToClipboard = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch (err) {
      console.error("Failed to copy text: ", err);
    }
  }, []);

  return {
    cellModal,
    setCellModal,
    handleCellDoubleClick,
    copyToClipboard,
  };
}

// ==============================
// Sub-Components
// ==============================

/**
 * Renders a table cell with proper formatting
 */
const TableCellRenderer = ({
  cell,
  cellIndex,
  columnWidths,
  columnName,
  onDoubleClick,
}: {
  cell: string | number;
  cellIndex: number;
  columnWidths: number[];
  columnName: string;
  onDoubleClick: (content: string | number, columnName: string) => void;
}) => {
  const cellContent = String(cell);
  const isLongText = cellContent.length > 100;
  const isJson = typeof cell === "string" && isJsonString(cell);

  // Create JSON preview if needed
  const jsonPreview = isJson ? createJsonPreview(cellContent) : null;

  return (
    <TableCell
      className={`font-mono text-sm ${isLongText || isJson ? "cursor-pointer" : "whitespace-nowrap"}`}
      style={{
        minWidth: columnWidths[cellIndex]
          ? `${columnWidths[cellIndex]}px`
          : undefined,
        maxWidth: isLongText ? "300px" : undefined,
      }}
      onDoubleClick={() => onDoubleClick(cell, columnName)}
      title={
        isLongText || isJson ? "Double-click to view full content" : undefined
      }
    >
      <div className={isLongText && !isJson ? "truncate" : ""}>
        {typeof cell === "number" ? (
          cell.toLocaleString()
        ) : isJson ? (
          <div className="flex flex-col">
            <div className="truncate font-mono text-xs text-muted-foreground">
              {jsonPreview}
            </div>
          </div>
        ) : (
          cellContent
        )}
      </div>
    </TableCell>
  );
};

/**
 * Renders table pagination controls
 */
const TablePagination = ({
  currentPage,
  totalPages,
  startRow,
  endRow,
  rowCount,
  goToPage,
  itemsPerPage,
  changePageSize,
}: {
  currentPage: number;
  totalPages: number;
  startRow: number;
  endRow: number;
  rowCount: number;
  goToPage: (page: number) => void;
  itemsPerPage: number;
  changePageSize: (size: number) => void;
}) => {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 border-t bg-muted/30 p-4">
      <div className="flex items-center gap-3 text-sm text-muted-foreground">
        <div className="whitespace-nowrap">
          {rowCount > 0 ? (
            <>
              Showing {startRow}-{endRow} of {rowCount} entries
            </>
          ) : (
            "No data to display"
          )}
        </div>

        {/* Page size control */}
        <div className="flex items-center gap-2">
          <Select
            value={String(itemsPerPage)}
            onValueChange={(value) => changePageSize(Number(value))}
          >
            <SelectTrigger className="h-8 w-[100px] bg-background px-2 text-xs">
              <SelectValue placeholder="Rows" />
            </SelectTrigger>
            <SelectContent
              position="popper"
              align="center"
              side="top"
              avoidCollisions
              className="w-[110px]"
            >
              {PAGE_SIZE_OPTIONS.map((size) => (
                <SelectItem key={size} value={String(size)}>
                  {size} rows
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center gap-2">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  disabled={currentPage === 0}
                  onClick={() => goToPage(0)}
                >
                  <ChevronLeft className="h-3 w-3" />
                  <ChevronLeft className="-ml-1 h-3 w-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                <p>First page</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>

          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            disabled={currentPage === 0}
            onClick={() => goToPage(currentPage - 1)}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>

          <div className="flex items-center gap-1">
            {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
              // Show pages around current page
              let pageToShow;
              if (totalPages <= 5) {
                pageToShow = i;
              } else if (currentPage <= 1) {
                pageToShow = i;
              } else if (currentPage >= totalPages - 3) {
                pageToShow = totalPages - 5 + i;
              } else {
                pageToShow = currentPage - 2 + i;
              }

              return (
                <Button
                  key={pageToShow}
                  variant={currentPage === pageToShow ? "default" : "outline"}
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => goToPage(pageToShow)}
                >
                  {pageToShow + 1}
                </Button>
              );
            })}
          </div>

          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            disabled={currentPage >= totalPages - 1}
            onClick={() => goToPage(currentPage + 1)}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>

          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  disabled={currentPage >= totalPages - 1}
                  onClick={() => goToPage(totalPages - 1)}
                >
                  <ChevronRight className="h-3 w-3" />
                  <ChevronRight className="-ml-1 h-3 w-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                <p>Last page</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      )}
    </div>
  );
};

/**
 * Renders the column selection view in the filter popover
 */
const ColumnSelectionView = ({
  processedData,
  filterState,
  getColumnFilters,
  setFilterUIState,
  clearAllFilters,
}: {
  processedData: any;
  filterState: FilterState[];
  getColumnFilters: (columnIndex: number) => FilterState[];
  setFilterUIState: React.Dispatch<
    React.SetStateAction<{
      mode: "columns" | "conditions";
      selectedColumn: number | null;
    }>
  >;
  clearAllFilters: () => void;
}) => {
  return (
    <>
      <div className="border-b p-3">
        <h4 className="font-medium">Select Column to Filter</h4>
        <p className="mt-1 text-sm text-muted-foreground">
          Choose a column to add or edit filters
        </p>
      </div>
      <div className="max-h-[400px] overflow-y-auto p-0">
        <div className="grid grid-cols-1 divide-y">
          {processedData.col.map((col: any, index: number) => {
            const columnFilters = getColumnFilters(index);
            return (
              <button
                key={index}
                className={`flex w-full items-center justify-between p-3 text-left hover:bg-muted/50 ${
                  columnFilters.length > 0 ? "bg-muted/20" : ""
                }`}
                onClick={() => {
                  setFilterUIState({
                    mode: "conditions",
                    selectedColumn: index,
                  });
                }}
              >
                <div className="flex items-center gap-2">
                  <span className="font-medium">{col.name}</span>
                  <Badge
                    variant="outline"
                    className="h-5 px-1.5 font-mono text-xs"
                  >
                    {col.dtype}
                  </Badge>
                </div>

                <div className="flex items-center">
                  {columnFilters.length > 0 && (
                    <Badge variant="secondary" className="mr-2">
                      {columnFilters.length}
                    </Badge>
                  )}
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </div>
              </button>
            );
          })}
        </div>
      </div>
      {filterState.length > 0 && (
        <div className="flex items-center justify-between border-t bg-muted/30 p-3">
          <div className="text-sm text-muted-foreground">
            {filterState.length} active filter
            {filterState.length !== 1 ? "s" : ""}
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={clearAllFilters}
            className="h-8 gap-1 text-xs"
          >
            <X className="h-3.5 w-3.5" />
            Clear all
          </Button>
        </div>
      )}
    </>
  );
};

/**
 * Renders the filter conditions view for a selected column
 */
const FilterConditionsView = ({
  filterUIState,
  processedData,
  getColumnFilters,
  clearColumnFilters,
  getFilterValue,
  changeFilterOperator,
  applyFilter,
  removeFilter,
  addFilterCondition,
  setFilterUIState,
}: {
  filterUIState: {
    mode: "columns" | "conditions";
    selectedColumn: number | null;
  };
  processedData: any;
  getColumnFilters: (columnIndex: number) => FilterState[];
  clearColumnFilters: (columnIndex: number) => void;
  getFilterValue: (filterId: string) => string;
  changeFilterOperator: (filterId: string, newOperator: string) => void;
  applyFilter: (
    columnIndex: number,
    value: string,
    operator?: string,
    filterId?: string,
  ) => void;
  removeFilter: (filterId: string) => void;
  addFilterCondition: (columnIndex: number, operator?: string) => void;
  setFilterUIState: React.Dispatch<
    React.SetStateAction<{
      mode: "columns" | "conditions";
      selectedColumn: number | null;
    }>
  >;
}) => {
  return (
    <>
      <div className="flex items-center justify-between border-b p-3">
        <Button
          variant="ghost"
          size="sm"
          className="-ml-1 h-8 w-8 p-0"
          onClick={() => {
            setFilterUIState({
              mode: "columns",
              selectedColumn: null,
            });
          }}
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <div className="flex flex-col items-center">
          <h4 className="font-medium">
            {filterUIState.selectedColumn !== null
              ? processedData.col[filterUIState.selectedColumn]?.name ||
                `Column ${filterUIState.selectedColumn + 1}`
              : "Filter"}
          </h4>
        </div>
        <div className="w-8" />
      </div>

      <div className="space-y-4 p-3">
        {filterUIState.selectedColumn !== null && (
          <>
            {(() => {
              const index = filterUIState.selectedColumn;
              const col = processedData.col[index];
              const columnFilters = getColumnFilters(index);
              const isNumeric = col.dtype === "int" || col.dtype === "float";

              return (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Badge
                        variant="outline"
                        className="h-5 px-1.5 font-mono text-xs"
                      >
                        {col.dtype}
                      </Badge>
                    </div>
                    {columnFilters.length > 0 && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 text-xs"
                        onClick={() => clearColumnFilters(index)}
                      >
                        <X className="mr-1 h-3.5 w-3.5" />
                        Clear
                      </Button>
                    )}
                  </div>

                  {isNumeric ? (
                    // Numeric column filters with operators
                    <div className="space-y-2">
                      {/* Show existing filters */}
                      {columnFilters.map((filter) => (
                        <div
                          key={filter.id}
                          className="flex items-center gap-2"
                        >
                          <Select
                            value={filter.operator}
                            onValueChange={(newOp) =>
                              changeFilterOperator(filter.id, newOp)
                            }
                          >
                            <SelectTrigger className="h-8 w-16">
                              <SelectValue placeholder="=" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="=">=</SelectItem>
                              <SelectItem value=">">{">"}</SelectItem>
                              <SelectItem value=">=">{"≥"}</SelectItem>
                              <SelectItem value="<">{"<"}</SelectItem>
                              <SelectItem value="<=">{"≤"}</SelectItem>
                              <SelectItem value="!=">{"≠"}</SelectItem>
                            </SelectContent>
                          </Select>

                          <Input
                            placeholder="Value..."
                            className="h-8 flex-1 text-sm"
                            value={getFilterValue(filter.id)}
                            onChange={(e) =>
                              applyFilter(
                                index,
                                e.target.value,
                                filter.operator,
                                filter.id,
                              )
                            }
                            type="number"
                            step={col.dtype === "float" ? "0.01" : "1"}
                          />

                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 p-0"
                            onClick={() => removeFilter(filter.id)}
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                      ))}

                      {/* Add filter button */}
                      {columnFilters.length < 6 && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="mt-1 h-8 w-full text-xs"
                          onClick={() => {
                            // Find an operator that isn't used yet, default to =
                            const operators = NUMERIC_OPERATORS;
                            const usedOperators = columnFilters.map(
                              (f) => f.operator,
                            );
                            const availableOps = operators.filter(
                              (op) => !usedOperators.includes(op),
                            );
                            const availableOp =
                              availableOps.length > 0 ? availableOps[0] : "=";

                            // Add a new filter condition
                            addFilterCondition(index, availableOp);
                          }}
                        >
                          Add condition
                        </Button>
                      )}
                    </div>
                  ) : (
                    // Text column filter - simplified to always use single text filter
                    <Input
                      placeholder="Enter filter text..."
                      className="h-8 text-sm"
                      value={
                        columnFilters.length > 0 ? columnFilters[0].value : ""
                      }
                      onChange={(e) => {
                        if (columnFilters.length > 0) {
                          // Update existing text filter
                          applyFilter(
                            index,
                            e.target.value,
                            "=",
                            columnFilters[0].id,
                          );
                        } else {
                          // Create new text filter
                          applyFilter(index, e.target.value, "=");
                        }
                      }}
                    />
                  )}

                  {columnFilters.length > 0 && !isNumeric && (
                    <div className="text-xs text-muted-foreground">
                      Text contains match (case insensitive)
                    </div>
                  )}
                </div>
              );
            })()}
          </>
        )}
      </div>

      <div className="flex justify-end border-t bg-muted/30 p-3">
        <Button
          variant="default"
          size="sm"
          className="h-8 text-xs"
          onClick={() => {
            setFilterUIState({
              mode: "columns",
              selectedColumn: null,
            });
          }}
        >
          Done
        </Button>
      </div>
    </>
  );
};

// ==============================
// Main Component
// ==============================

export const TableView = ({
  log,
  tenantId,
  projectName,
  runId,
}: TableViewProps) => {
  // Refs and state
  const tableRef = useRef<HTMLDivElement>(null);
  const [columnWidths, setColumnWidths] = useState<number[]>([]);
  const [sortState, setSortState] = useState<SortState | null>(null);

  // Custom hooks
  const {
    filterState,
    searchValue,
    setSearchValue,
    activeFilters,
    filterUIState,
    setFilterUIState,
    applyFilter,
    changeFilterOperator,
    addFilterCondition,
    removeFilter,
    clearColumnFilters,
    clearAllFilters,
    hasFilter,
    getColumnFilters,
    getFilterValue,
  } = useTableFilters();

  const { cellModal, setCellModal, handleCellDoubleClick, copyToClipboard } =
    useCellModal();

  // Data fetching
  const { data, isLoading } = useQuery(
    trpc.runs.data.table.queryOptions({
      organizationId: tenantId,
      runId,
      projectName,
      logName: log.logName,
    }),
  );

  // Process the raw data
  const latestTableData = useMemo(() => {
    if (!data || data.length === 0) return null;
    // Get the latest table data by sorting by time
    return data.sort(
      (a: TableResponse, b: TableResponse) =>
        b.time.getTime() - a.time.getTime(),
    )[0].tableData;
  }, [data]);

  // Calculate column widths based on content
  useEffect(() => {
    if (
      latestTableData?.table?.length &&
      latestTableData.table[0]?.length &&
      tableRef.current
    ) {
      const tableWidth = tableRef.current.offsetWidth;
      const numcol =
        latestTableData.col?.length || latestTableData.table[0].length;

      // Calculate better column widths based on data content
      const calculatedWidths = new Array(numcol).fill(0);

      // First pass: determine minimum width based on column headers
      const colNames =
        latestTableData.col?.map((c) => c.name) ||
        Array(numcol)
          .fill("")
          .map((_, i) => `Column ${i + 1}`);

      // Estimate width based on text length (approximately 8px per character plus padding)
      colNames.forEach((name, idx) => {
        calculatedWidths[idx] = Math.max(
          calculatedWidths[idx],
          Math.min(300, Math.max(80, name.length * 9 + 56)), // Min 80px, max 300px
        );
      });

      // Second pass: check first few rows for content width estimation
      const sampleSize = Math.min(20, latestTableData.table.length);
      for (let rowIdx = 0; rowIdx < sampleSize; rowIdx++) {
        const row = latestTableData.table[rowIdx];
        row.forEach((cell, colIdx) => {
          // Calculate width based on content type and length
          let estimatedWidth = 80; // Minimum width
          if (typeof cell === "number") {
            // For numbers, width depends on digits
            estimatedWidth = Math.max(80, String(cell).length * 9 + 32);
          } else {
            // For strings, cap at reasonable display width
            const str = String(cell);
            estimatedWidth = Math.min(
              300,
              Math.max(80, Math.min(str.length, 30) * 9 + 32),
            );
          }
          calculatedWidths[colIdx] = Math.max(
            calculatedWidths[colIdx],
            estimatedWidth,
          );
        });
      }

      // Ensure table fits within container if possible
      const totalContentWidth = calculatedWidths.reduce(
        (sum, width) => sum + width,
        0,
      );
      if (totalContentWidth < tableWidth) {
        // Distribute remaining space proportionally
        const extraSpace = tableWidth - totalContentWidth;
        const extraPerCol = extraSpace / numcol;
        for (let i = 0; i < calculatedWidths.length; i++) {
          calculatedWidths[i] += extraPerCol;
        }
      }

      setColumnWidths(calculatedWidths);
    }
  }, [
    latestTableData?.table?.length,
    latestTableData?.table?.[0]?.length,
    latestTableData?.col?.length,
  ]);

  // Apply filters and sorting to the data
  const processedData = useMemo(() => {
    if (!latestTableData?.table) return { table: [], col: [], row: [] };

    const startTime = performance.now();

    let filteredData = [...latestTableData.table];
    const col = latestTableData.col || [];
    const row = latestTableData.row || [];

    // If data is already small, skip complex operations
    if (filteredData.length === 0) {
      return { table: [], col, row };
    }

    // Generate column types if missing
    let processedCols = col;
    if (processedCols.length === 0 && filteredData[0]?.length > 0) {
      processedCols = filteredData[0].map((_, index) => ({
        name: `Column ${index + 1}`,
        dtype: typeof filteredData[0][index] === "number" ? "float" : "str",
      }));
    }

    // Apply filtering - only if we have filters
    if (filterState.length > 0 || searchValue) {
      // Apply column filters
      if (filterState.length > 0) {
        filteredData = filteredData.filter((row) => {
          // Group filters by column for more reliable processing
          const filtersByColumn: Record<number, FilterState[]> = {};

          for (const filter of filterState) {
            if (!filtersByColumn[filter.column]) {
              filtersByColumn[filter.column] = [];
            }
            filtersByColumn[filter.column].push(filter);
          }

          // For each column, check if ANY of its filters match (OR within same column)
          for (const columnIndex in filtersByColumn) {
            const colIdx = Number(columnIndex);
            const colFilters = filtersByColumn[colIdx];
            const columnDtype = processedCols[colIdx]?.dtype || "str";
            const cellValue = row[colIdx];

            // If no filter matches for this column, return false (AND between columns)
            const anyFilterMatches = colFilters.some((filter) => {
              // Skip invalid filters
              if (filter.value.trim() === "") return true;

              // For numeric columns with operators
              if (
                (columnDtype === "int" || columnDtype === "float") &&
                !isNaN(Number(cellValue))
              ) {
                const numValue = Number(cellValue);
                const filterValue = Number(filter.value);

                // Skip if filter value is not a valid number
                if (isNaN(filterValue)) return true;

                switch (filter.operator) {
                  case "=":
                    return numValue === filterValue;
                  case ">":
                    return numValue > filterValue;
                  case ">=":
                    return numValue >= filterValue;
                  case "<":
                    return numValue < filterValue;
                  case "<=":
                    return numValue <= filterValue;
                  case "!=":
                    return numValue !== filterValue;
                  default:
                    return numValue === filterValue;
                }
              } else {
                // For strings, use contains
                return String(cellValue)
                  .toLowerCase()
                  .includes(filter.value.toLowerCase());
              }
            });

            if (!anyFilterMatches) return false;
          }
          return true;
        });
      }

      // Apply global search
      if (searchValue) {
        const search = searchValue.toLowerCase();
        filteredData = filteredData.filter((row) => {
          for (const cell of row) {
            if (String(cell).toLowerCase().includes(search)) {
              return true;
            }
          }
          return false;
        });
      }
    }

    // Apply sorting
    if (sortState) {
      const { column, direction } = sortState;
      const columnDtype = processedCols[column]?.dtype || "str";

      // Use optimized sort based on data type
      if (columnDtype === "int" || columnDtype === "float") {
        filteredData.sort((a, b) => {
          const numA = Number(a[column]);
          const numB = Number(b[column]);
          return direction === "asc" ? numA - numB : numB - numA;
        });
      } else {
        filteredData.sort((a, b) => {
          const strA = String(a[column]).toLowerCase();
          const strB = String(b[column]).toLowerCase();
          return direction === "asc"
            ? strA.localeCompare(strB)
            : strB.localeCompare(strA);
        });
      }
    }

    const endTime = performance.now();
    console.debug(`Table processing took ${endTime - startTime}ms`);

    return {
      table: filteredData,
      col: processedCols,
      row,
    };
  }, [latestTableData, sortState, filterState, searchValue]);

  // Check if we have row labels to display
  const hasRowLabels = useMemo(() => {
    return Boolean(processedData.row?.length);
  }, [processedData.row]);

  // Pagination management
  const { currentPage, itemsPerPage, totalPages, goToPage, changePageSize } =
    usePagination(processedData.table.length);

  // Paginate data for current page
  const paginatedData = useMemo(() => {
    const startIdx = currentPage * itemsPerPage;
    return processedData.table.slice(startIdx, startIdx + itemsPerPage);
  }, [processedData.table, currentPage, itemsPerPage]);

  // Get row labels for current page - only if needed
  const paginatedRowLabels = useMemo(() => {
    if (!hasRowLabels) return [];
    const startIdx = currentPage * itemsPerPage;
    return processedData.row.slice(startIdx, startIdx + itemsPerPage);
  }, [processedData.row, currentPage, itemsPerPage, hasRowLabels]);

  // Toggle sort
  const toggleSort = useCallback((columnIndex: number) => {
    setSortState((prev) => {
      if (prev?.column === columnIndex) {
        // Toggle direction if already sorting by this column
        return {
          column: columnIndex,
          direction: prev.direction === "asc" ? "desc" : "asc",
        };
      } else {
        // Start with ascending sort for new column
        return {
          column: columnIndex,
          direction: "asc",
        };
      }
    });
  }, []);

  // Calculate table data statistics for display
  const rowCount = processedData.table.length;
  const startRow = rowCount > 0 ? currentPage * itemsPerPage + 1 : 0;
  const endRow = Math.min(startRow + itemsPerPage - 1, rowCount);

  // Loading state
  if (isLoading) {
    return (
      <div className="h-full space-y-6 p-4">
        <h3 className="text-center font-mono text-lg font-medium text-muted-foreground">
          {log.logName}
        </h3>
        <div className="flex h-[calc(100%-60px)] flex-col items-center justify-center">
          <div className="h-full w-full max-w-4xl">
            <div className="group relative flex h-full items-center justify-center">
              <div className="relative h-full w-full overflow-hidden rounded-md">
                <Skeleton className="h-full w-full" />
              </div>
            </div>
            <Skeleton className="mx-auto mt-3 h-4 w-48" />
          </div>
        </div>
      </div>
    );
  }

  // No data state
  if (!latestTableData) {
    return (
      <div className="space-y-4">
        <h3 className="text-center font-mono text-lg font-medium text-muted-foreground">
          {log.logName}
        </h3>
        <div className="flex h-40 items-center justify-center text-muted-foreground">
          <div className="flex flex-col items-center gap-2">
            <FileSpreadsheet className="h-10 w-10 text-muted-foreground/40" />
            <p>No table data available</p>
          </div>
        </div>
      </div>
    );
  }

  // Render table with data
  return (
    <div className="flex h-full flex-col space-y-6 p-4">
      <h3 className="text-center font-mono text-lg font-medium">
        {log.logName}
      </h3>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border bg-card shadow-sm">
        {/* Header with search and filters */}
        <div className="flex flex-wrap items-center justify-between gap-4 border-b bg-muted/40 p-4">
          <div className="relative min-w-[200px] flex-1">
            <Search className="absolute top-2.5 left-2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search across all columns..."
              className="bg-background pl-8"
              value={searchValue}
              onChange={(e) => setSearchValue(e.target.value)}
            />
            {searchValue && (
              <Button
                variant="ghost"
                size="sm"
                className="absolute top-1.5 right-1 h-7 w-7 p-0"
                onClick={() => setSearchValue("")}
              >
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className={`gap-2 ${filterState.length > 0 ? "border-primary text-primary" : ""}`}
                >
                  <Filter className="h-4 w-4" />
                  {filterState.length > 0 && (
                    <Badge variant="secondary" className="h-5 px-1.5 text-xs">
                      {filterState.length}
                    </Badge>
                  )}
                  Filter
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[300px] p-0" align="end">
                {filterUIState.mode === "columns" ? (
                  <ColumnSelectionView
                    processedData={processedData}
                    filterState={filterState}
                    getColumnFilters={getColumnFilters}
                    setFilterUIState={setFilterUIState}
                    clearAllFilters={clearAllFilters}
                  />
                ) : (
                  <FilterConditionsView
                    filterUIState={filterUIState}
                    processedData={processedData}
                    getColumnFilters={getColumnFilters}
                    clearColumnFilters={clearColumnFilters}
                    getFilterValue={getFilterValue}
                    changeFilterOperator={changeFilterOperator}
                    applyFilter={applyFilter}
                    removeFilter={removeFilter}
                    addFilterCondition={addFilterCondition}
                    setFilterUIState={setFilterUIState}
                  />
                )}
              </PopoverContent>
            </Popover>

            {activeFilters > 0 && (
              <Badge variant="outline" className="gap-1 text-xs">
                {activeFilters} active filter{activeFilters !== 1 ? "s" : ""}
              </Badge>
            )}
            {activeFilters > 0 && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={clearAllFilters}
                      className="gap-1"
                    >
                      <X className="h-3.5 w-3.5" />
                      Clear
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Clear all filters</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
          </div>
        </div>

        {/* Table container with overflow handling */}
        <div className="flex-1 overflow-auto p-3">
          <div ref={tableRef} className="w-full">
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-card">
                <TableRow className="hover:bg-transparent">
                  {/* Row header cell (if we have row labels) */}
                  {hasRowLabels && (
                    <TableHead className="relative border-r bg-muted/30 py-3">
                      <div className="px-2 py-1 text-center font-medium">
                        {/* Empty corner cell */}
                      </div>
                    </TableHead>
                  )}

                  {/* Column headers */}
                  {processedData.col.map((col, index) => (
                    <TableHead
                      key={index}
                      className="relative bg-muted/30 py-3"
                      style={{
                        minWidth: columnWidths[index]
                          ? `${columnWidths[index]}px`
                          : undefined,
                      }}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1">
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-8 justify-start px-2 py-1 text-left font-medium hover:bg-muted"
                                  onClick={() => toggleSort(index)}
                                >
                                  <span className="font-medium">
                                    {col.name}
                                  </span>
                                  <div className="ml-1.5">
                                    {sortState?.column === index ? (
                                      sortState.direction === "asc" ? (
                                        <ChevronUp className="h-4 w-4 text-primary" />
                                      ) : (
                                        <ChevronDown className="h-4 w-4 text-primary" />
                                      )
                                    ) : (
                                      <ArrowUpDown className="h-4 w-4 text-muted-foreground opacity-50" />
                                    )}
                                  </div>
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>
                                <p>Click to sort by {col.name}</p>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                          {hasFilter(index) && (
                            <Badge
                              variant="outline"
                              className="h-5 border-primary px-1.5 py-0.5 text-xs text-primary"
                            >
                              <Filter className="mr-0.5 h-3 w-3" />
                            </Badge>
                          )}
                        </div>
                      </div>
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {paginatedData.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={
                        hasRowLabels
                          ? processedData.col.length + 1
                          : processedData.col.length
                      }
                      className="h-32 text-center text-muted-foreground"
                    >
                      <div className="flex flex-col items-center gap-2">
                        <Search className="h-8 w-8 text-muted-foreground/50" />
                        <p>No matching records found</p>
                        {activeFilters > 0 && (
                          <Button
                            variant="link"
                            size="sm"
                            onClick={clearAllFilters}
                            className="mt-1"
                          >
                            Clear all filters
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  paginatedData.map((row, rowIndex) => (
                    <TableRow key={rowIndex} className="hover:bg-muted/30">
                      {/* Row label if available */}
                      {hasRowLabels && (
                        <TableCell className="border-r bg-muted/20 text-sm font-medium whitespace-nowrap">
                          {paginatedRowLabels[rowIndex]?.name ||
                            `Row ${currentPage * itemsPerPage + rowIndex + 1}`}
                        </TableCell>
                      )}

                      {/* Row data */}
                      {row.map((cell, cellIndex) => {
                        const columnName =
                          processedData.col[cellIndex]?.name ||
                          `Column ${cellIndex + 1}`;
                        return (
                          <TableCellRenderer
                            key={cellIndex}
                            cell={cell}
                            cellIndex={cellIndex}
                            columnWidths={columnWidths}
                            columnName={columnName}
                            onDoubleClick={handleCellDoubleClick}
                          />
                        );
                      })}
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </div>

        {/* Pagination controls */}
        <TablePagination
          currentPage={currentPage}
          totalPages={totalPages}
          startRow={startRow}
          endRow={endRow}
          rowCount={rowCount}
          goToPage={goToPage}
          itemsPerPage={itemsPerPage}
          changePageSize={changePageSize}
        />
      </div>

      {/* Full content modal */}
      <Dialog
        open={cellModal.isOpen}
        onOpenChange={(open) =>
          setCellModal((prev) => ({ ...prev, isOpen: open }))
        }
      >
        <DialogContent className="flex max-h-[80vh] max-w-3xl flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center justify-between">
              <span>{cellModal.title}</span>
              {cellModal.isJson && (
                <Badge variant="outline" className="ml-2">
                  JSON
                </Badge>
              )}
            </DialogTitle>
          </DialogHeader>

          <ScrollArea className="mt-2 mb-4 max-h-[60vh] flex-1">
            <pre
              className={`overflow-auto rounded-md bg-muted/50 p-4 text-sm ${cellModal.isJson ? "font-mono" : ""}`}
            >
              {cellModal.content}
            </pre>
          </ScrollArea>

          <DialogFooter>
            <Button
              size="sm"
              variant="outline"
              className="gap-2"
              onClick={() =>
                cellModal.content && copyToClipboard(String(cellModal.content))
              }
            >
              <Copy className="h-3.5 w-3.5" />
              Copy to clipboard
            </Button>
            <Button
              size="sm"
              variant="default"
              onClick={() =>
                setCellModal((prev) => ({ ...prev, isOpen: false }))
              }
            >
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
