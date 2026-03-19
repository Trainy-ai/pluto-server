import { useState, useCallback, useRef } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { DiffSpan } from "@/lib/inline-diff";
import { tryPrettyPrintJson, isJsonString } from "@/lib/json-format";
import { InlineDiffText } from "./inline-diff-span";

export const COLLAPSED_MAX_HEIGHT = 60; // px - roughly 3 lines of monospace text

interface CollapsibleCellProps {
  value: string;
  isEmpty: boolean;
  /** When provided, renders inline diff highlighting instead of plain text. */
  diffSpans?: DiffSpan[];
  /** When true, JSON string values are pretty-printed with indentation. */
  prettyJson?: boolean;
}

/**
 * Collapsible cell for long content — default collapsed.
 * Pretty-prints JSON values when prettyJson is enabled.
 * Supports inline diff highlighting via diffSpans.
 */
export function CollapsibleCell({ value, isEmpty, diffSpans, prettyJson }: CollapsibleCellProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [needsCollapse, setNeedsCollapse] = useState(false);

  const checkOverflow = useCallback((el: HTMLDivElement | null) => {
    contentRef.current = el;
    if (el) {
      setNeedsCollapse(el.scrollHeight > COLLAPSED_MAX_HEIGHT);
    }
  }, []);

  const handleToggle = useCallback(() => {
    const wasExpanded = isExpanded;
    setIsExpanded(!wasExpanded);
    // When collapsing, scroll the row back into view so the user isn't stranded
    if (wasExpanded && containerRef.current) {
      requestAnimationFrame(() => {
        containerRef.current?.closest("tr")?.scrollIntoView({ block: "nearest", behavior: "smooth" });
      });
    }
  }, [isExpanded]);

  if (isEmpty) {
    return <span className="break-all font-mono text-xs">-</span>;
  }

  // Check if the value is JSON and should be pretty-printed
  const isJson = prettyJson && isJsonString(value);

  // Determine what to render as content
  const renderContent = () => {
    if (diffSpans) {
      return <InlineDiffText spans={diffSpans} />;
    }
    if (isJson) {
      return tryPrettyPrintJson(value);
    }
    return value;
  };

  return (
    <div ref={containerRef}>
      <div
        ref={checkOverflow}
        className="break-all font-mono text-xs overflow-hidden"
        style={{
          ...(!isExpanded && needsCollapse ? { maxHeight: COLLAPSED_MAX_HEIGHT } : {}),
          ...(isJson || diffSpans ? { whiteSpace: "pre-wrap" } : {}),
        }}
      >
        {renderContent()}
      </div>
      {needsCollapse && (
        <button
          type="button"
          onClick={handleToggle}
          className="mt-1 flex items-center gap-0.5 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
        >
          {isExpanded ? (
            <>
              <ChevronDown className="h-3 w-3" />
              Show less
            </>
          ) : (
            <>
              <ChevronRight className="h-3 w-3" />
              Show more
            </>
          )}
        </button>
      )}
    </div>
  );
}
