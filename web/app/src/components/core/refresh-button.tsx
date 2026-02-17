"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { RotateCw, ChevronDown, Check } from "lucide-react";
import { cn } from "@/lib/utils";

const keyboardShortcut = "R";

const REFRESH_INTERVALS = [
  { label: "Off", value: null },
  { label: "5s", value: 5_000 },
  { label: "10s", value: 10_000 },
  { label: "30s", value: 30_000 },
  { label: "1m", value: 60_000 },
  { label: "5m", value: 300_000 },
  { label: "10m", value: 600_000 },
  { label: "30m", value: 1_800_000 },
] as const;

type IntervalValue = (typeof REFRESH_INTERVALS)[number]["value"];

function getIntervalLabel(value: IntervalValue): string {
  const interval = REFRESH_INTERVALS.find((i) => i.value === value);
  return interval?.label ?? "Off";
}

interface RefreshButtonProps {
  onRefresh: () => Promise<void> | void;
  label?: string;
  lastRefreshed?: Date;
  className?: string;
  /** Default auto-refresh interval in ms, or null for off. */
  defaultInterval?: number | null;
  rateLimitMs?: number;
  /** localStorage key to persist the user's interval choice. */
  storageKey?: string;
}

const KeyboardShortcut = () => (
  <kbd className="pointer-events-none inline-flex h-5 items-center gap-1 rounded border bg-background px-1.5 font-mono text-[10px] font-medium text-muted-foreground opacity-100 select-none">
    {keyboardShortcut}
  </kbd>
);

export function RefreshButton({
  onRefresh,
  label = "Refresh",
  lastRefreshed: lastRefreshedProp,
  className,
  defaultInterval = 60_000,
  rateLimitMs = 500,
  storageKey,
}: RefreshButtonProps) {
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(
    lastRefreshedProp ?? null,
  );
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastKeyPressRef = useRef<number>(0);
  const onRefreshRef = useRef(onRefresh);
  onRefreshRef.current = onRefresh;

  // Resolve initial interval: localStorage (user choice) > defaultInterval prop
  const [activeInterval, setActiveIntervalRaw] = useState<IntervalValue>(() => {
    if (storageKey) {
      try {
        const saved = localStorage.getItem(storageKey);
        if (saved === "off") return null;
        if (saved && saved !== "null") {
          const n = Number(saved);
          const match = REFRESH_INTERVALS.find((i) => i.value === n);
          if (match) return match.value;
        }
      } catch {}
    }
    return defaultInterval as IntervalValue;
  });

  const setActiveInterval = useCallback(
    (value: IntervalValue) => {
      setActiveIntervalRaw(value);
      if (storageKey) {
        try {
          localStorage.setItem(storageKey, value === null ? "off" : String(value));
        } catch {}
      }
    },
    [storageKey],
  );

  // When the parent changes `defaultInterval` (e.g. run goes from RUNNING to COMPLETED),
  // update only if the user hasn't made a localStorage choice
  useEffect(() => {
    if (storageKey) {
      try {
        const saved = localStorage.getItem(storageKey);
        if (saved !== null) return; // user has a saved preference, don't override
      } catch {}
    }
    setActiveIntervalRaw(defaultInterval as IntervalValue);
  }, [defaultInterval, storageKey]);

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
  };

  const handleRefresh = useCallback(async () => {
    if (isRefreshing) return;

    setIsRefreshing(true);
    try {
      await onRefreshRef.current();
      setLastRefreshed(new Date());
    } catch (error) {
      console.error("Refresh failed:", error);
    } finally {
      setTimeout(() => {
        setIsRefreshing(false);
      }, 500);
    }
  }, [isRefreshing]);

  const handleRefreshRef = useRef(handleRefresh);
  handleRefreshRef.current = handleRefresh;

  // Manage the auto-refresh interval
  useEffect(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    if (activeInterval !== null) {
      timerRef.current = setInterval(() => {
        void handleRefreshRef.current();
      }, activeInterval);
    }

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, [activeInterval]);

  // Keyboard shortcut (R key)
  useEffect(() => {
    const handleKeyPress = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable
      ) {
        return;
      }

      if (
        event.key.toLowerCase() === keyboardShortcut.toLowerCase() &&
        !event.ctrlKey &&
        !event.metaKey
      ) {
        const target = event.target as HTMLElement | null;
        if (target) {
          const tagName = target.tagName.toLowerCase();
          if (
            tagName === "input" ||
            tagName === "textarea" ||
            tagName === "select" ||
            target.isContentEditable ||
            target.closest("[role='dialog']") ||
            target.closest("[role='combobox']") ||
            target.closest("[role='listbox']") ||
            target.closest("[data-radix-popper-content-wrapper]")
          ) {
            return;
          }
        }
        const now = Date.now();
        if (now - lastKeyPressRef.current >= rateLimitMs) {
          lastKeyPressRef.current = now;
          handleRefresh();
        }
      }
    };

    window.addEventListener("keydown", handleKeyPress);
    return () => window.removeEventListener("keydown", handleKeyPress);
  }, [rateLimitMs, handleRefresh]);

  const isAutoRefresh = activeInterval !== null;

  return (
    <div className="inline-flex">
      <div className="relative inline-flex rounded-md border bg-background shadow-sm">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              onClick={handleRefresh}
              disabled={isRefreshing}
              variant="ghost"
              className={cn(
                "h-9 rounded-r-none border-0 bg-transparent px-3 transition-all hover:bg-accent/50",
                isAutoRefresh && "text-primary",
                className,
              )}
              aria-label={`${label} (Press ${keyboardShortcut})`}
            >
              <div className="flex items-center justify-center">
                <RotateCw
                  className={cn(
                    "mr-2 h-4 w-4 transition-transform",
                    isRefreshing && "animate-spin",
                  )}
                  aria-hidden="true"
                />
                <div className="flex items-center">
                  <span className="text-sm font-medium">
                    {isAutoRefresh ? getIntervalLabel(activeInterval) : label}
                  </span>
                  {lastRefreshed && (
                    <span className="ml-1.5 text-xs text-muted-foreground">
                      {formatTime(lastRefreshed)}
                    </span>
                  )}
                </div>
              </div>
            </Button>
          </TooltipTrigger>
          <TooltipContent className="flex items-center gap-2">
            <span>Press</span>
            <KeyboardShortcut />
            <span>to refresh</span>
          </TooltipContent>
        </Tooltip>

        <DropdownMenu open={dropdownOpen} onOpenChange={setDropdownOpen}>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="flex h-9 w-8 items-center justify-center rounded-l-none border-0 border-l bg-transparent px-0 hover:bg-accent/50"
              aria-label="Auto refresh interval"
            >
              <ChevronDown className="h-4 w-4" aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44 p-1">
            <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
              Auto refresh
            </div>
            {REFRESH_INTERVALS.map((interval) => (
              <button
                key={interval.label}
                className={cn(
                  "flex w-full items-center justify-between rounded-sm px-2 py-1.5 text-sm outline-none transition-colors hover:bg-accent hover:text-accent-foreground",
                  activeInterval === interval.value && "bg-accent/50 font-medium",
                )}
                onClick={() => {
                  setActiveInterval(interval.value);
                  setDropdownOpen(false);
                }}
              >
                <span>{interval.label}</span>
                {activeInterval === interval.value && (
                  <Check className="h-3.5 w-3.5 text-primary" />
                )}
              </button>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
