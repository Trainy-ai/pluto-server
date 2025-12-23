"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { AnsiUp } from "ansi_up";
import { debounce } from "lodash";
import { ChevronDown, ChevronUp, Search, X } from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";

export interface LogEntry {
  text: string;
  timestamp: Date;
}

export interface TimeDetails {
  utc: string;
  localTime: string;
  relativeToStart: string;
  relativeToLast: string;
}

interface TerminalLogsProps {
  logs: LogEntry[];
  noScroll?: boolean; // Optional prop to render without scroll, defaults to false
  logType: "INFO" | "ERROR";
  onLogTypeChange: (type: "INFO" | "ERROR") => void;
}

const ansiUp = new AnsiUp();
// Use CSS classes for ANSI output so you can control the colors via CSS
ansiUp.use_classes = true;

function useTimeFormatting() {
  const mainTimeFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(undefined, {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        fractionalSecondDigits: 3,
        hour12: false,
      }),
    [],
  );

  const localFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "medium",
      }),
    [],
  );

  const utcFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat("en-US", {
        dateStyle: "medium",
        timeStyle: "medium",
        timeZone: "UTC",
      }),
    [],
  );

  return {
    formatters: {
      main: mainTimeFormatter,
      local: localFormatter,
      utc: utcFormatter,
    },
  };
}

function useSearch(logs: LogEntry[]) {
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [searchMode, setSearchMode] = useState<"filter" | "navigate">("filter");
  const [currentMatchIndex, setCurrentMatchIndex] = useState(0);

  // Debounce search updates
  useEffect(() => {
    const handler = debounce((value: string) => setDebouncedQuery(value), 300);
    handler(searchQuery);
    return () => handler.cancel();
  }, [searchQuery]);

  // Filter logs based on search
  const filteredLogs = useMemo(() => {
    if (!debouncedQuery) return logs;
    if (searchMode === "filter") {
      const query = debouncedQuery.toLowerCase();
      return logs.filter((log) => log.text.toLowerCase().includes(query));
    }
    return logs;
  }, [logs, debouncedQuery, searchMode]);

  // Find search matches for navigation
  const { matches, totalMatches } = useMemo(() => {
    if (!debouncedQuery || searchMode !== "navigate") {
      return { matches: [] as number[], totalMatches: 0 };
    }
    const query = debouncedQuery.toLowerCase();
    const results = logs.reduce((acc, log, index) => {
      if (log.text.toLowerCase().includes(query)) {
        acc.push(index);
      }
      return acc;
    }, [] as number[]);
    return { matches: results, totalMatches: results.length };
  }, [logs, debouncedQuery, searchMode]);

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
      return matches[newIndex];
    },
    [currentMatchIndex, matches],
  );

  return {
    searchQuery,
    setSearchQuery,
    searchMode,
    setSearchMode,
    filteredLogs,
    matches,
    totalMatches,
    currentMatchIndex,
    navigateSearch,
  };
}

function useTimeDetails(
  logs: LogEntry[],
  formatters: ReturnType<typeof useTimeFormatting>["formatters"],
) {
  return useCallback(
    (timestamp: Date, index: number): TimeDetails => {
      const utcDate = new Date(0);
      utcDate.setUTCMilliseconds(timestamp.getTime());

      const startTime = logs[0]?.timestamp.getTime() || timestamp.getTime();
      const previousTime =
        index > 0 ? logs[index - 1].timestamp.getTime() : startTime;

      return {
        utc: formatters.utc.format(utcDate),
        localTime: formatters.local.format(utcDate),
        relativeToStart: `${((timestamp.getTime() - startTime) / 1000).toFixed(3)}s`,
        relativeToLast: `${((timestamp.getTime() - previousTime) / 1000).toFixed(3)}s`,
      };
    },
    [logs, formatters],
  );
}

const TimeTooltipContent = memo(
  ({ timeDetails }: { timeDetails: TimeDetails }) => (
    <div className="grid min-w-[300px] gap-2 p-2">
      <div className="grid grid-cols-[140px_1fr] gap-2">
        <span className="text-muted-foreground">Local Time</span>
        <span className="text-foreground">{timeDetails.localTime}</span>
      </div>
      <div className="grid grid-cols-[140px_1fr] gap-2">
        <span className="text-muted-foreground">UTC</span>
        <span className="text-foreground">{timeDetails.utc}</span>
      </div>
      <div className="grid grid-cols-[140px_1fr] gap-2">
        <span className="text-muted-foreground">Relative to start</span>
        <span className="text-foreground">{timeDetails.relativeToStart}</span>
      </div>
      <div className="grid grid-cols-[140px_1fr] gap-2">
        <span className="text-muted-foreground">Relative to previous</span>
        <span className="text-foreground">{timeDetails.relativeToLast}</span>
      </div>
    </div>
  ),
);

TimeTooltipContent.displayName = "TimeTooltipContent";

const LogEntryComponent = memo(
  ({
    log,
    index,
    searchQuery,
    getTimeDetails,
    mainTimeFormatter,
  }: {
    log: LogEntry;
    index: number;
    searchQuery: string;
    getTimeDetails: (timestamp: Date, index: number) => TimeDetails;
    mainTimeFormatter: Intl.DateTimeFormat;
  }) => {
    const timeDetails = useMemo(
      () => getTimeDetails(log.timestamp, index),
      [log.timestamp, index, getTimeDetails],
    );

    // Convert ANSI escape sequences to HTML (with classes) and apply search highlighting
    const highlightedText = useMemo(() => {
      const htmlText = ansiUp.ansi_to_html(log.text);
      if (!searchQuery) return htmlText;
      return htmlText.replace(
        new RegExp(searchQuery, "gi"),
        (match) =>
          `<mark class="bg-yellow-500/30 dark:text-white text-black">${match}</mark>`,
      );
    }, [log.text, searchQuery]);

    return (
      <div className="group flex hover:bg-muted/50">
        <div className="flex border-r border-border bg-muted/50 group-hover:bg-muted/50">
          <TooltipProvider delayDuration={0}>
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="w-[128px] flex-none cursor-default px-4 py-1 text-right font-mono text-muted-foreground tabular-nums select-none">
                  {mainTimeFormatter.format(log.timestamp)}
                </div>
              </TooltipTrigger>
              <TooltipContent
                side="right"
                className="border border-border bg-background font-mono"
                sideOffset={5}
              >
                <TimeTooltipContent timeDetails={timeDetails} />
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <div className="w-[1px] bg-border" />
          <TooltipProvider delayDuration={0}>
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="w-[60px] flex-none cursor-default px-2 py-1 text-right font-mono text-muted-foreground tabular-nums select-none">
                  {index + 1}
                </div>
              </TooltipTrigger>
              <TooltipContent
                side="right"
                className="border border-border bg-background font-mono"
                sideOffset={5}
              >
                <TimeTooltipContent timeDetails={timeDetails} />
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
        <div className="w-[1px] bg-border" />
        <div
          className="flex-1 px-4 py-1 break-all whitespace-pre-wrap text-foreground"
          dangerouslySetInnerHTML={{ __html: highlightedText }}
        />
      </div>
    );
  },
);

LogEntryComponent.displayName = "LogEntryComponent";

export default function TerminalLogs({
  logs,
  noScroll = false,
  logType,
  onLogTypeChange,
}: TerminalLogsProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const { formatters } = useTimeFormatting();
  const {
    searchQuery,
    setSearchQuery,
    searchMode,
    setSearchMode,
    filteredLogs,
    matches,
    totalMatches,
    currentMatchIndex,
    navigateSearch,
  } = useSearch(logs);

  const getTimeDetails = useTimeDetails(logs, formatters);

  // Set up virtualization with dynamic row measurement
  const rowVirtualizer = useVirtualizer({
    count: filteredLogs.length,
    getScrollElement: () => containerRef.current,
    estimateSize: useCallback(() => 24, []), // Initial estimate
    overscan: 5, // Reduced overscan since measuring is more expensive
    measureElement: useCallback((element: Element) => {
      // Get the actual height of the rendered element
      return element?.getBoundingClientRect().height || 24;
    }, []),
  });

  // Scroll to match when navigating
  const scrollToMatch = useCallback(
    (index: number) => {
      rowVirtualizer.scrollToIndex(index, { align: "center" });
    },
    [rowVirtualizer],
  );

  // Handle keyboard navigation
  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      if (searchMode === "navigate" && e.key === "Enter") {
        const matchIndex = navigateSearch(e.shiftKey ? "prev" : "next");
        if (matchIndex !== undefined) scrollToMatch(matchIndex);
      }
    };

    window.addEventListener("keydown", handleKeyPress);
    return () => window.removeEventListener("keydown", handleKeyPress);
  }, [searchMode, navigateSearch, scrollToMatch]);

  return (
    <div className="h-full w-full overflow-hidden rounded-lg border border-border bg-background">
      <div className="flex items-center gap-4 border-b border-border bg-muted p-4">
        <div className="flex items-center gap-2">
          <div className="flex bg-muted/30 p-1">
            <Button
              variant={logType === "INFO" ? "secondary" : "ghost"}
              size="sm"
              onClick={() => onLogTypeChange("INFO")}
              className={`px-4 font-mono font-medium transition-all ${
                logType === "INFO"
                  ? "bg-blue-500/20 text-blue-600 hover:bg-blue-500/30 dark:text-blue-400"
                  : "hover:bg-muted"
              }`}
            >
              stdout
            </Button>
            <Button
              variant={logType === "ERROR" ? "secondary" : "ghost"}
              size="sm"
              onClick={() => onLogTypeChange("ERROR")}
              className={`px-4 font-mono font-medium transition-all ${
                logType === "ERROR"
                  ? "bg-red-500/20 text-red-600 hover:bg-red-500/30 dark:text-red-400"
                  : "hover:bg-muted"
              }`}
            >
              stderr
            </Button>
          </div>
        </div>
        <div className="flex-1" />
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute top-1/2 left-2 h-4 w-4 -translate-y-1/2 transform text-muted-foreground" />
            <Input
              type="text"
              placeholder="Search logs..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="border-border bg-background/50 pr-24 pl-8 text-foreground"
            />
            {searchQuery && searchMode === "navigate" && (
              <div className="absolute top-1/2 right-2 flex -translate-y-1/2 transform items-center gap-1 text-sm text-muted-foreground">
                <span>
                  {totalMatches > 0
                    ? `${currentMatchIndex}/${totalMatches}`
                    : "0/0"}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 hover:bg-muted"
                  onClick={() => {
                    const matchIndex = navigateSearch("prev");
                    if (matchIndex !== undefined) scrollToMatch(matchIndex);
                  }}
                  disabled={totalMatches === 0}
                >
                  <ChevronUp className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 hover:bg-muted"
                  onClick={() => {
                    const matchIndex = navigateSearch("next");
                    if (matchIndex !== undefined) scrollToMatch(matchIndex);
                  }}
                  disabled={totalMatches === 0}
                >
                  <ChevronDown className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 hover:bg-muted"
                  onClick={() => setSearchQuery("")}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            )}
          </div>
          <Button
            variant={searchMode === "navigate" ? "secondary" : "outline"}
            size="sm"
            onClick={() =>
              setSearchMode(searchMode === "filter" ? "navigate" : "filter")
            }
            className="border-border bg-background/50 text-sm hover:bg-muted"
          >
            {searchMode === "filter" ? "Filter" : "Navigate"}
          </Button>
        </div>
      </div>
      <div
        ref={containerRef}
        className={`font-mono text-sm leading-4 ${
          noScroll ? "" : "max-h-[calc(100vh-10rem)] overflow-auto"
        } [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border hover:[&::-webkit-scrollbar-thumb]:bg-muted-foreground/50 [&::-webkit-scrollbar-track]:bg-transparent`}
      >
        {filteredLogs.length === 0 ? (
          <div className="flex h-32 items-center justify-center text-muted-foreground">
            No logs found for the selected type
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
              const log = filteredLogs[virtualRow.index];
              return (
                <div
                  key={`${log.timestamp}-${virtualRow.index}`}
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
                  <LogEntryComponent
                    log={log}
                    index={virtualRow.index}
                    searchQuery={searchQuery}
                    getTimeDetails={getTimeDetails}
                    mainTimeFormatter={formatters.main}
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
