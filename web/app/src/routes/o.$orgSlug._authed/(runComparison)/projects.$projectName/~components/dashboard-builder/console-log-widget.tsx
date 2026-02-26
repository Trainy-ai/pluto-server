import { useMemo, useRef, useCallback, useState, useEffect } from "react";
import { AnsiUp } from "ansi_up";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Loader2Icon, Search, ChevronUp, ChevronDown, X } from "lucide-react";
import { debounce } from "lodash";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useConsoleLogs } from "../../~queries/console-logs";
import type { ConsoleLogType } from "./console-log-constants";
import { consoleLogTypeToClickHouseFilter } from "./console-log-constants";

const ansiUp = new AnsiUp();
ansiUp.use_classes = true;

interface ConsoleLogWidgetProps {
  logType: ConsoleLogType;
  runs: { runId: string; runName: string; color: string }[];
  organizationId: string;
  projectName: string;
}

export function ConsoleLogWidget({
  logType,
  runs,
  organizationId,
  projectName,
}: ConsoleLogWidgetProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  if (runs.length > 1) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <p className="text-sm">Widget does not support multiple runs.</p>
      </div>
    );
  }

  if (runs.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <p className="text-sm">No runs selected</p>
      </div>
    );
  }

  return (
    <ConsoleLogWidgetInner
      logType={logType}
      runId={runs[0].runId}
      organizationId={organizationId}
      projectName={projectName}
      containerRef={containerRef}
    />
  );
}

function ConsoleLogWidgetInner({
  logType,
  runId,
  organizationId,
  projectName,
  containerRef,
}: {
  logType: ConsoleLogType;
  runId: string;
  organizationId: string;
  projectName: string;
  containerRef: React.RefObject<HTMLDivElement | null>;
}) {
  const isStdout = logType === "CONSOLE_STDOUT";
  const chLogType = consoleLogTypeToClickHouseFilter(logType);
  const { data: logs, isLoading } = useConsoleLogs(
    organizationId,
    projectName,
    runId,
    chLogType,
  );

  // Search state
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [searchMode, setSearchMode] = useState<"filter" | "navigate">("filter");
  const [currentMatchIndex, setCurrentMatchIndex] = useState(0);

  useEffect(() => {
    const handler = debounce((value: string) => setDebouncedQuery(value), 300);
    handler(searchQuery);
    return () => handler.cancel();
  }, [searchQuery]);

  const entries = useMemo(() => {
    if (!logs) return [];
    return logs.map((log) => ({
      message: log.message,
      lineNumber: log.lineNumber,
    }));
  }, [logs]);

  // Filter entries for "filter" search mode
  const filteredEntries = useMemo(() => {
    if (!debouncedQuery || searchMode !== "filter") return entries;
    const query = debouncedQuery.toLowerCase();
    return entries.filter((e) => e.message.toLowerCase().includes(query));
  }, [entries, debouncedQuery, searchMode]);

  // Navigate mode: find match indices in unfiltered entries
  const { matches, totalMatches } = useMemo(() => {
    if (!debouncedQuery || searchMode !== "navigate") {
      return { matches: [] as number[], totalMatches: 0 };
    }
    const query = debouncedQuery.toLowerCase();
    const results = entries.reduce((acc, entry, index) => {
      if (entry.message.toLowerCase().includes(query)) {
        acc.push(index);
      }
      return acc;
    }, [] as number[]);
    return { matches: results, totalMatches: results.length };
  }, [entries, debouncedQuery, searchMode]);

  const displayEntries = searchMode === "filter" ? filteredEntries : entries;

  const rowVirtualizer = useVirtualizer({
    count: displayEntries.length,
    getScrollElement: () => containerRef.current,
    estimateSize: useCallback(() => 20, []),
    overscan: 10,
    measureElement: useCallback(
      (element: Element) => element?.getBoundingClientRect().height || 20,
      [],
    ),
  });

  const navigateSearch = useCallback(
    (direction: "next" | "prev") => {
      if (matches.length === 0) return;
      let newIndex = currentMatchIndex - 1;
      if (direction === "next") {
        newIndex = (newIndex + 1) % matches.length;
      } else {
        newIndex = (newIndex - 1 + matches.length) % matches.length;
      }
      setCurrentMatchIndex(newIndex + 1);
      rowVirtualizer.scrollToIndex(matches[newIndex], { align: "center" });
    },
    [currentMatchIndex, matches, rowVirtualizer],
  );

  // Keyboard navigation — scoped to the search input (passed to WidgetToolbar)
  const handleSearchKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (searchMode === "navigate" && e.key === "Enter") {
        e.preventDefault();
        navigateSearch(e.shiftKey ? "prev" : "next");
      }
    },
    [searchMode, navigateSearch],
  );

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <Loader2Icon className="size-5 animate-spin" />
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div className="flex h-full flex-col overflow-hidden rounded border border-border bg-background">
        <WidgetToolbar
          isStdout={isStdout}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          searchMode={searchMode}
          onSearchModeChange={setSearchMode}
          totalMatches={totalMatches}
          currentMatchIndex={currentMatchIndex}
          onNavigate={navigateSearch}
          onSearchKeyDown={handleSearchKeyDown}
        />
        <div className="flex flex-1 items-center justify-center text-muted-foreground">
          <p className="text-sm">No logs found for the selected type.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden rounded border border-border bg-background">
      <WidgetToolbar
        isStdout={isStdout}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        searchMode={searchMode}
        onSearchModeChange={setSearchMode}
        totalMatches={totalMatches}
        currentMatchIndex={currentMatchIndex}
        onNavigate={navigateSearch}
        onSearchKeyDown={handleSearchKeyDown}
      />
      <div
        ref={containerRef}
        className="flex-1 overflow-auto font-mono text-xs leading-5 [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border hover:[&::-webkit-scrollbar-thumb]:bg-muted-foreground/50 [&::-webkit-scrollbar-track]:bg-transparent"
      >
        {displayEntries.length === 0 ? (
          <div className="flex h-32 items-center justify-center text-muted-foreground">
            No matching logs
          </div>
        ) : (
          <div
            style={{
              height: `${rowVirtualizer.getTotalSize()}px`,
              width: "100%",
              position: "relative",
            }}
          >
            {rowVirtualizer.getVirtualItems().map((virtualRow) => {
              const entry = displayEntries[virtualRow.index];
              return (
                <div
                  key={virtualRow.index}
                  data-index={virtualRow.index}
                  ref={rowVirtualizer.measureElement}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                >
                  <div className="group flex hover:bg-muted/50">
                    <div className="w-[50px] shrink-0 border-r border-border bg-muted/30 px-2 py-0.5 text-right tabular-nums text-muted-foreground select-none">
                      {entry.lineNumber}
                    </div>
                    <LogLine message={entry.message} searchQuery={debouncedQuery} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Renders a single log line with safe ANSI coloring and search highlighting.
 * Instead of doing regex replacement on HTML (which can inject into tag attributes),
 * we split the raw text on search matches, convert each segment through ansi_up
 * separately, and wrap matched segments in <mark>.
 */
function LogLine({ message, searchQuery }: { message: string; searchQuery: string }) {
  const html = useMemo(() => {
    if (!searchQuery) {
      return ansiUp.ansi_to_html(message);
    }
    // Split the raw message on search matches (case-insensitive).
    // This operates on plain text, not HTML, so it can't break tags.
    const escaped = searchQuery.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(`(${escaped})`, "gi");
    const parts = message.split(regex);

    return parts
      .map((part) => {
        const converted = ansiUp.ansi_to_html(part);
        if (regex.test(part)) {
          // Reset lastIndex since we reuse the regex with 'g' flag
          regex.lastIndex = 0;
          return `<mark class="bg-yellow-500/30 dark:text-white text-black">${converted}</mark>`;
        }
        regex.lastIndex = 0;
        return converted;
      })
      .join("");
  }, [message, searchQuery]);

  return (
    <div
      className="flex-1 whitespace-pre-wrap break-all px-3 py-0.5 text-foreground"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

/** Toolbar with stdout/stderr label and search bar. */
function WidgetToolbar({
  isStdout,
  searchQuery,
  onSearchChange,
  searchMode,
  onSearchModeChange,
  totalMatches,
  currentMatchIndex,
  onNavigate,
  onSearchKeyDown,
}: {
  isStdout: boolean;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  searchMode: "filter" | "navigate";
  onSearchModeChange: (mode: "filter" | "navigate") => void;
  totalMatches: number;
  currentMatchIndex: number;
  onNavigate: (direction: "next" | "prev") => void;
  onSearchKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
}) {
  return (
    <div className="flex shrink-0 items-center gap-3 border-b border-border bg-muted/50 px-3 py-1.5">
      <span
        className={`rounded px-2.5 py-0.5 font-mono text-xs font-medium ${
          isStdout
            ? "bg-blue-500/20 text-blue-600 dark:text-blue-400"
            : "bg-red-500/20 text-red-600 dark:text-red-400"
        }`}
      >
        {isStdout ? "stdout" : "stderr"}
      </span>
      <div className="flex-1" />
      <div className="flex items-center gap-1.5">
        <div className="relative">
          <Search className="absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="text"
            placeholder="Search..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            onKeyDown={onSearchKeyDown}
            className="h-7 w-[160px] border-border bg-background/50 pr-16 pl-7 text-xs"
          />
          {searchQuery && searchMode === "navigate" && (
            <div className="absolute top-1/2 right-1 flex -translate-y-1/2 items-center gap-0.5 text-xs text-muted-foreground">
              <span>
                {totalMatches > 0 ? `${currentMatchIndex}/${totalMatches}` : "0/0"}
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="size-5"
                onClick={() => onNavigate("prev")}
                disabled={totalMatches === 0}
              >
                <ChevronUp className="size-3" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="size-5"
                onClick={() => onNavigate("next")}
                disabled={totalMatches === 0}
              >
                <ChevronDown className="size-3" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="size-5"
                onClick={() => onSearchChange("")}
              >
                <X className="size-3" />
              </Button>
            </div>
          )}
        </div>
        <Button
          variant={searchMode === "navigate" ? "secondary" : "outline"}
          size="sm"
          onClick={() =>
            onSearchModeChange(searchMode === "filter" ? "navigate" : "filter")
          }
          className="h-7 border-border bg-background/50 px-2 text-xs"
        >
          {searchMode === "filter" ? "Filter" : "Navigate"}
        </Button>
      </div>
    </div>
  );
}
