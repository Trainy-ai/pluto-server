import React, { useEffect, useRef } from "react";
import type { Run } from "../../../~queries/list-runs";
import { cn } from "@/lib/utils";

interface SearchOtherMatchesDropdownProps {
  outOfView: Run[];
  inView: Run[];
  hasMore: boolean;
  isLoading: boolean;
  selectedRunsWithColors: Record<string, { run: Run; color: string }>;
  onSelectRun: (run: Run) => void;
  /** Fired by both Esc and click-outside. Caller decides what to do — the
   *  current parent route uses it to mark the dropdown as dismissed while
   *  leaving the search input value alone. */
  onDismiss: () => void;
}

function formatCreatedAt(value: Date | string | undefined): string {
  if (!value) return "";
  try {
    const d = value instanceof Date ? value : new Date(value);
    // An invalid date string yields an Invalid Date object rather than
    // throwing — `toLocaleString` would then render the literal
    // "Invalid Date". Guard explicitly so the UI shows nothing instead.
    if (isNaN(d.getTime())) return "";
    return d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

export function SearchOtherMatchesDropdown({
  outOfView,
  inView,
  hasMore,
  isLoading,
  selectedRunsWithColors,
  onSelectRun,
  onDismiss,
}: SearchOtherMatchesDropdownProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Esc dismisses (same as click-outside) — keeps the typed query so the
  // user can re-open the popover by refocusing the input.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onDismiss();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onDismiss]);

  // Click outside the search-input wrapper (the dropdown's parent in DOM,
  // which also contains the search input + icon) calls `onDismiss`.
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const node = containerRef.current;
      if (!node) return;
      const wrapper = node.parentElement;
      if (!wrapper) return;
      if (!wrapper.contains(e.target as Node)) {
        onDismiss();
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onDismiss]);

  // No out-of-view runs => no value in showing the dropdown
  if (outOfView.length === 0 && !isLoading) {
    return null;
  }

  // Order: out-of-view first (actionable), then in-view (informational)
  const rows = [...outOfView, ...inView];
  const inViewIds = new Set(inView.map((r) => r.id));

  return (
    <div
      ref={containerRef}
      data-testid="search-other-matches-dropdown"
      className="absolute top-full left-0 right-0 z-50 mt-1 max-h-80 overflow-y-auto rounded-md border border-border bg-popover shadow-md"
    >
      <div className="px-2 pt-2 pb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
        Other matches — outside current view
      </div>
      {isLoading && rows.length === 0 && (
        <div className="px-2 py-2 text-xs text-muted-foreground">Loading…</div>
      )}
      {rows.map((run) => {
        const isInView = inViewIds.has(run.id);
        const selectionColor = selectedRunsWithColors[run.id]?.color;
        return (
          <button
            key={run.id}
            type="button"
            data-testid={`other-match-row-${run.id}`}
            aria-disabled={isInView ? "true" : undefined}
            disabled={isInView}
            onClick={() => {
              if (isInView) return;
              onSelectRun(run);
            }}
            className={cn(
              "flex w-full items-center gap-2 px-2 py-1.5 text-left text-sm",
              isInView
                ? "cursor-default text-muted-foreground/60"
                : "hover:bg-accent",
            )}
          >
            {selectionColor ? (
              <span
                className="inline-block h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: selectionColor }}
                aria-hidden
              />
            ) : (
              <span className="inline-block h-2 w-2 shrink-0" />
            )}
            <span
              className="min-w-0 flex-1 truncate font-medium"
              title={run.name}
            >
              {run.name}
            </span>
            <span className="shrink-0 font-mono text-xs text-muted-foreground">
              {run.displayId ?? run.id}
            </span>
            <span className="shrink-0 text-xs text-muted-foreground">
              {run.status}
            </span>
            <span className="shrink-0 text-xs text-muted-foreground">
              {formatCreatedAt(run.createdAt)}
            </span>
            {isInView && (
              <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide">
                In table
              </span>
            )}
          </button>
        );
      })}
      {hasMore && (
        <div className="px-2 pt-1 pb-2 text-xs text-muted-foreground">
          Showing top results — refine your search to see more.
        </div>
      )}
    </div>
  );
}
