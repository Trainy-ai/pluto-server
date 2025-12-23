"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  ChevronDown,
  ChevronUp,
  LayoutGrid,
  ChevronLeft,
  ChevronRight,
  MoveDiagonal2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import styles from "./dropdown-region.module.css";
import { Slider } from "@/components/ui/slider";

// Constants
const MIN_COLUMNS = 1;
const MAX_COLUMNS = 8;
const DEFAULT_COLUMNS = 3;

const MIN_ROWS = 1;
const MAX_ROWS = 8;
const DEFAULT_ROWS = 3;

const DEFAULT_GRID_SIZE = 8;

// Default settings for initialization
const defaultSettings: DropdownSettings = {
  isOpen: true,
  columns: DEFAULT_COLUMNS,
  rows: DEFAULT_ROWS,
  pinnedIndices: [],
  currentPage: 1,
  globalCardHeight: null,
};

// Interfaces
interface DropdownSettings {
  isOpen: boolean;
  columns: number;
  rows: number;
  pinnedIndices: number[];
  currentPage: number;
  globalCardHeight: number | null;
}

interface DropdownRegionProps {
  title: string;
  components: React.ReactNode[];
  groupId: string;
}

interface GridSelectorProps {
  onSelect: (rows: number, columns: number) => void;
  selectedRows: number;
  selectedColumns: number;
}

interface DraggingState {
  index: number;
  startX: number;
  startY: number;
  initialWidth: number;
  initialHeight: number;
  containerWidth: number;
  initialRect: DOMRect;
}

interface GhostDimensions {
  width: number;
  height: number;
  top: number;
  left: number;
}

// Local Storage Utilities
export function resetDropdownRegion(groupId: string) {
  localStorage.removeItem(`dropdown_${groupId}`);
}

export function saveToLocalStorage(
  groupId: string,
  settings: DropdownSettings,
) {
  localStorage.setItem(`dropdown_${groupId}`, JSON.stringify(settings));
}

export function loadFromLocalStorage(groupId: string): DropdownSettings | null {
  const saved = localStorage.getItem(`dropdown_${groupId}`);
  return saved ? JSON.parse(saved) : null;
}

// GridSelector Component (unchanged except for removing console logs)
const GridSelector = ({
  onSelect,
  selectedRows,
  selectedColumns,
}: GridSelectorProps) => {
  const [hoveredCell, setHoveredCell] = useState<{
    row: number;
    col: number;
  } | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const handleCellHover = useCallback(
    (row: number, col: number) => {
      if (isDragging) {
        onSelect(row + 1, col + 1);
      }
      setHoveredCell({ row, col });
    },
    [isDragging, onSelect],
  );

  const handleMouseDown = useCallback(
    (row: number, col: number) => {
      setIsDragging(true);
      onSelect(row + 1, col + 1);
      setHoveredCell({ row, col });
    },
    [onSelect],
  );

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
    setHoveredCell(null);
  }, []);

  return (
    <div className="mt-4">
      <div className="mb-2 text-sm font-medium">Select Grid Size</div>
      <div
        className="grid aspect-square w-full gap-1 rounded-lg border p-2"
        style={{
          gridTemplateColumns: `repeat(${DEFAULT_GRID_SIZE}, 1fr)`,
          gridTemplateRows: `repeat(${DEFAULT_GRID_SIZE}, 1fr)`,
        }}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        {Array.from({ length: DEFAULT_GRID_SIZE * DEFAULT_GRID_SIZE }).map(
          (_, i) => {
            const row = Math.floor(i / DEFAULT_GRID_SIZE);
            const col = i % DEFAULT_GRID_SIZE;
            const isSelected = row < selectedRows && col < selectedColumns;
            const isHovered =
              hoveredCell && row <= hoveredCell.row && col <= hoveredCell.col;
            const wouldBeRemoved =
              isSelected &&
              hoveredCell &&
              (row > hoveredCell.row || col > hoveredCell.col);

            return (
              <div
                key={i}
                className={cn(
                  "aspect-square rounded transition-colors",
                  isSelected
                    ? wouldBeRemoved
                      ? "bg-destructive/30"
                      : "bg-primary"
                    : isHovered
                      ? "bg-primary/30"
                      : "bg-muted hover:bg-muted/80",
                )}
                onMouseDown={() => handleMouseDown(row, col)}
                onMouseEnter={() => handleCellHover(row, col)}
              />
            );
          },
        )}
      </div>
      <div className="mt-2 flex items-center justify-between text-sm text-muted-foreground">
        <span>
          Selected: {selectedColumns} × {selectedRows}
        </span>
        <span>
          Max: {DEFAULT_GRID_SIZE} × {DEFAULT_GRID_SIZE}
        </span>
      </div>
    </div>
  );
};

// Optimized DropdownRegion Component
export function DropdownRegion({
  title,
  components,
  groupId,
}: DropdownRegionProps) {
  // Initialize settings with saved values or defaults
  const [settings, setSettings] = useState<DropdownSettings>(() => {
    const saved = loadFromLocalStorage(groupId);
    return saved ? { ...defaultSettings, ...saved } : defaultSettings;
  });

  // Separate states for dialog and resize functionality
  const [tempColumns, setTempColumns] = useState(settings.columns.toString());
  const [tempRows, setTempRows] = useState(settings.rows.toString());
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [containerWidth, setContainerWidth] = useState<number>(0);
  const [draggingState, setDraggingState] = useState<DraggingState | null>(
    null,
  );
  const [ghostDimensions, setGhostDimensions] =
    useState<GhostDimensions | null>(null);

  const gridContainerRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<Record<number, HTMLDivElement | null>>({});

  const itemsPerPage = settings.columns * settings.rows;

  // Sync temp inputs with settings changes
  useEffect(() => {
    setTempColumns(settings.columns.toString());
    setTempRows(settings.rows.toString());
  }, [settings.columns, settings.rows]);

  // Resize observer for container width
  useEffect(() => {
    const gridElement = gridContainerRef.current;
    if (!gridElement) return;

    const resizeObserver = new ResizeObserver((entries) => {
      if (entries[0]) {
        setContainerWidth(entries[0].contentRect.width);
      }
    });

    resizeObserver.observe(gridElement);

    const timeoutId = setTimeout(() => {
      if (gridElement.offsetWidth > 0) {
        setContainerWidth(gridElement.offsetWidth);
      }
    }, 100);

    return () => {
      clearTimeout(timeoutId);
      resizeObserver.disconnect();
    };
  }, []);

  // Adjust currentPage if it exceeds total pages
  useEffect(() => {
    const unpinnedCount = components.length - settings.pinnedIndices.length;
    const maxPages = Math.max(1, Math.ceil(unpinnedCount / itemsPerPage));
    if (settings.currentPage > maxPages) {
      setSettings((prev) => ({ ...prev, currentPage: maxPages }));
    }
  }, [
    components.length,
    settings.pinnedIndices.length,
    itemsPerPage,
    settings.currentPage,
  ]);

  // Save settings to local storage
  useEffect(() => {
    saveToLocalStorage(groupId, settings);
  }, [settings, groupId]);

  // Handlers
  const handleColumnChange = (value: string) => {
    setTempColumns(value);
    const numValue = parseInt(value);
    if (
      !isNaN(numValue) &&
      numValue >= MIN_COLUMNS &&
      numValue <= MAX_COLUMNS
    ) {
      setSettings((prev) => ({ ...prev, columns: numValue, currentPage: 1 }));
    }
  };

  const handleRowChange = (value: string) => {
    setTempRows(value);
    const numValue = parseInt(value);
    if (!isNaN(numValue) && numValue >= MIN_ROWS && numValue <= MAX_ROWS) {
      setSettings((prev) => ({ ...prev, rows: numValue, currentPage: 1 }));
    }
  };

  const togglePin = (index: number) => {
    setSettings((prev) => ({
      ...prev,
      pinnedIndices: prev.pinnedIndices.includes(index)
        ? prev.pinnedIndices.filter((i) => i !== index)
        : [...prev.pinnedIndices, index],
    }));
  };

  const handleGridSelect = (newRows: number, newColumns: number) => {
    setSettings((prev) => ({
      ...prev,
      rows: newRows,
      columns: newColumns,
      currentPage: 1,
    }));
    setTempRows(newRows.toString());
    setTempColumns(newColumns.toString());
  };

  const handleResizeMouseDown = useCallback(
    (index: number, event: React.MouseEvent<HTMLButtonElement>) => {
      const cardElement = cardRefs.current?.[index] ?? null;
      if (!cardElement) return;

      const initialCardRect = cardElement.getBoundingClientRect();
      if (initialCardRect.width <= 0 || initialCardRect.height <= 0) return;

      let currentContainerWidth = containerWidth;
      if (!currentContainerWidth || currentContainerWidth <= 0) {
        currentContainerWidth = gridContainerRef.current?.offsetWidth ?? 0;
        if (currentContainerWidth <= 0) return;
      }

      event.preventDefault();
      event.stopPropagation();

      const newDraggingState: DraggingState = {
        index,
        startX: event.clientX,
        startY: event.clientY,
        initialWidth: initialCardRect.width,
        initialHeight: initialCardRect.height,
        containerWidth: currentContainerWidth,
        initialRect: initialCardRect,
      };

      const startX = event.clientX;
      const startY = event.clientY;
      const initialWidth = initialCardRect.width;
      const initialHeight = initialCardRect.height;

      const localMouseMoveHandler = (moveEvent: MouseEvent) => {
        moveEvent.preventDefault();
        moveEvent.stopPropagation();

        const deltaX = moveEvent.clientX - startX;
        const deltaY = moveEvent.clientY - startY;

        const newWidth = Math.max(50, initialWidth + deltaX);
        const newHeight = Math.max(384, initialHeight + deltaY);

        setGhostDimensions({
          width: newWidth,
          height: newHeight,
          top: initialCardRect.top,
          left: initialCardRect.left,
        });
      };

      const localMouseUpHandler = (upEvent: MouseEvent) => {
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        window.removeEventListener("mousemove", localMouseMoveHandler);
        window.removeEventListener("mouseup", localMouseUpHandler);

        setDraggingState(null);
        setGhostDimensions(null);

        const deltaX = upEvent.clientX - startX;
        const deltaY = upEvent.clientY - startY;
        const finalTargetWidth = Math.max(50, initialWidth + deltaX);
        const finalTargetHeight = Math.max(384, initialHeight + deltaY);

        const availableWidth = currentContainerWidth;
        const gap = 16;
        if (availableWidth <= 0 || finalTargetWidth <= gap) return;

        const potentialColumns = Math.max(
          1,
          Math.floor(availableWidth / (finalTargetWidth + gap)),
        );
        const newColumns = Math.max(
          MIN_COLUMNS,
          Math.min(MAX_COLUMNS, potentialColumns),
        );

        setSettings((prev) => ({
          ...prev,
          columns: newColumns,
          globalCardHeight: finalTargetHeight,
          currentPage: 1,
        }));
      };

      setDraggingState(newDraggingState);
      setGhostDimensions({
        width: initialCardRect.width,
        height: initialCardRect.height,
        top: initialCardRect.top,
        left: initialCardRect.left,
      });

      window.addEventListener("mousemove", localMouseMoveHandler);
      window.addEventListener("mouseup", localMouseUpHandler);

      document.body.style.cursor = "nwse-resize";
      document.body.style.userSelect = "none";
    },
    [containerWidth],
  );

  // Pagination logic
  const sortedComponents = [...components].sort((_, b) => {
    const indexB = components.indexOf(b);
    return settings.pinnedIndices.includes(indexB) ? 1 : -1;
  });

  const unpinnedComponents = sortedComponents.filter(
    (_, index) => !settings.pinnedIndices.includes(index),
  );

  const currentPageStart = Math.max(
    0,
    (settings.currentPage - 1) * itemsPerPage,
  );
  const currentPageEnd = Math.min(
    unpinnedComponents.length,
    currentPageStart + itemsPerPage,
  );

  const currentPageComponents = unpinnedComponents.slice(
    currentPageStart,
    currentPageEnd,
  );

  const displayComponents = [
    ...sortedComponents.filter((_, index) =>
      settings.pinnedIndices.includes(index),
    ),
    ...currentPageComponents,
  ];

  const totalPages = Math.max(
    1,
    Math.ceil(
      (components.length - settings.pinnedIndices.length) / itemsPerPage,
    ),
  );

  const cardStyle: React.CSSProperties = settings.globalCardHeight
    ? { height: `${settings.globalCardHeight}px` }
    : {};

  return (
    <div className="w-full rounded-lg border shadow-sm">
      <div className="flex items-center justify-between p-4">
        <div className="flex items-center space-x-2">
          <button
            onClick={() =>
              setSettings((prev) => ({ ...prev, isOpen: !prev.isOpen }))
            }
            className="focus:outline-none"
          >
            {settings.isOpen ? (
              <ChevronUp className="h-5 w-5" />
            ) : (
              <ChevronDown className="h-5 w-5" />
            )}
          </button>
          <h2 className="flex w-full items-center justify-center text-center text-lg font-semibold">
            <div>{title}</div>
            <span className="ml-3 inline-flex items-center justify-center rounded-full bg-blue-600 px-2 py-1 text-xs leading-none font-bold text-blue-100">
              {components.length}
            </span>
          </h2>
        </div>
        <div className="flex items-center space-x-2">
          {totalPages > 1 && (
            <>
              <Button
                variant="ghost"
                size="icon"
                onClick={() =>
                  setSettings((prev) => ({
                    ...prev,
                    currentPage: Math.max(1, prev.currentPage - 1),
                  }))
                }
                disabled={settings.currentPage === 1}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="text-sm">
                {settings.currentPage} / {totalPages}
              </span>
              <Button
                variant="ghost"
                size="icon"
                onClick={() =>
                  setSettings((prev) => ({
                    ...prev,
                    currentPage: Math.min(totalPages, prev.currentPage + 1),
                  }))
                }
                disabled={settings.currentPage === totalPages}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </>
          )}
          <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogTrigger asChild>
              <Button variant="ghost" size="icon">
                <LayoutGrid className="h-4 w-4" />
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle>Grid Layout Settings</DialogTitle>
              </DialogHeader>
              <div className="space-y-6 py-4">
                <GridSelector
                  onSelect={handleGridSelect}
                  selectedRows={settings.rows}
                  selectedColumns={settings.columns}
                />
                <div className="space-y-4">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label htmlFor="columns">Columns</Label>
                      <span className="text-sm text-muted-foreground">
                        {settings.columns} columns
                      </span>
                    </div>
                    <div className="flex items-center gap-4">
                      <Slider
                        id="columns"
                        min={MIN_COLUMNS}
                        max={MAX_COLUMNS}
                        value={[settings.columns]}
                        onValueChange={([value]) => {
                          handleColumnChange(value.toString());
                        }}
                        className="flex-1"
                      />
                      <Input
                        type="number"
                        min={MIN_COLUMNS}
                        max={MAX_COLUMNS}
                        value={tempColumns}
                        onChange={(e) => handleColumnChange(e.target.value)}
                        className="w-16"
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label htmlFor="rows">Rows</Label>
                      <span className="text-sm text-muted-foreground">
                        {settings.rows} rows
                      </span>
                    </div>
                    <div className="flex items-center gap-4">
                      <Slider
                        id="rows"
                        min={MIN_ROWS}
                        max={MAX_ROWS}
                        value={[settings.rows]}
                        onValueChange={([value]) => {
                          handleRowChange(value.toString());
                        }}
                        className="flex-1"
                      />
                      <Input
                        type="number"
                        min={MIN_ROWS}
                        max={MAX_ROWS}
                        value={tempRows}
                        onChange={(e) => handleRowChange(e.target.value)}
                        className="w-16"
                      />
                    </div>
                  </div>
                </div>
                {(parseInt(tempColumns) > MAX_COLUMNS ||
                  parseInt(tempColumns) < MIN_COLUMNS ||
                  parseInt(tempRows) > MAX_ROWS ||
                  parseInt(tempRows) < MIN_ROWS) && (
                  <div className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
                    {parseInt(tempColumns) > MAX_COLUMNS && (
                      <p>Maximum {MAX_COLUMNS} columns allowed</p>
                    )}
                    {parseInt(tempColumns) < MIN_COLUMNS && (
                      <p>Minimum {MIN_COLUMNS} column required</p>
                    )}
                    {parseInt(tempRows) > MAX_ROWS && (
                      <p>Maximum {MAX_ROWS} rows allowed</p>
                    )}
                    {parseInt(tempRows) < MIN_ROWS && (
                      <p>Minimum {MIN_ROWS} row required</p>
                    )}
                  </div>
                )}
              </div>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => {
                    resetDropdownRegion(groupId);
                    window.location.reload();
                  }}
                >
                  Reset Layout
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>
      {settings.isOpen && (
        <div className="p-4" ref={gridContainerRef}>
          <div
            className={cn(
              styles.grid,
              draggingState && "cursor-nwse-resize select-none",
            )}
            style={
              {
                "--grid-cols-tablet": Math.min(2, settings.columns),
                "--grid-cols-desktop": settings.columns,
              } as React.CSSProperties
            }
          >
            {displayComponents.map((component) => {
              const originalIndex = components.indexOf(component);
              const isPinned = settings.pinnedIndices.includes(originalIndex);

              return (
                <div
                  key={originalIndex}
                  ref={(el) => {
                    if (cardRefs.current) {
                      cardRefs.current[originalIndex] = el;
                    }
                  }}
                  className={cn(styles.card, "group", "w-full bg-red-500")}
                  style={cardStyle}
                >
                  {component}
                  <button
                    onMouseDown={(e) => handleResizeMouseDown(originalIndex, e)}
                    className={cn(
                      "absolute -right-2 -bottom-2 z-30 h-5 w-5 cursor-nwse-resize rounded-full border bg-background p-1 text-muted-foreground shadow transition-opacity",
                      "opacity-0 group-hover:opacity-100",
                      draggingState?.index === originalIndex && "!opacity-100",
                      draggingState &&
                        draggingState.index !== originalIndex &&
                        "!group-hover:opacity-0 !opacity-0",
                    )}
                    aria-label="Resize card"
                  >
                    <MoveDiagonal2 className="h-full w-full" />
                  </button>
                </div>
              );
            })}
          </div>
          {ghostDimensions && (
            <div
              className="pointer-events-none fixed z-40 border-2 border-dashed border-blue-500 bg-blue-100/30"
              style={{
                width: `${ghostDimensions.width}px`,
                height: `${ghostDimensions.height}px`,
                top: `${ghostDimensions.top}px`,
                left: `${ghostDimensions.left}px`,
                transition: "none",
              }}
              aria-hidden="true"
            />
          )}
        </div>
      )}
    </div>
  );
}
