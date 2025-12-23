"use client";

import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
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
import { RotateCw, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

const keyboardShortcut = "R";

interface RefreshButtonProps {
  onRefresh: () => Promise<void> | void;
  label?: string;
  refreshInterval?: number;
  lastRefreshed?: Date;
  className?: string;
  defaultAutoRefresh?: boolean;
  rateLimitMs?: number;
}

const KeyboardShortcut = () => (
  <kbd className="pointer-events-none inline-flex h-5 items-center gap-1 rounded border bg-background px-1.5 font-mono text-[10px] font-medium text-muted-foreground opacity-100 select-none">
    {keyboardShortcut}
  </kbd>
);

export function RefreshButton({
  onRefresh,
  label = "Refresh",
  refreshInterval = 5000,
  lastRefreshed: lastRefreshedProp,
  className,
  defaultAutoRefresh = false,
  rateLimitMs = 500,
}: RefreshButtonProps) {
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(
    lastRefreshedProp ?? null,
  );
  const [autoRefresh, setAutoRefresh] = useState(defaultAutoRefresh);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const lastKeyPressRef = useRef<number>(0);

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
  };

  const handleRefresh = async () => {
    if (isRefreshing) return;

    setIsRefreshing(true);
    try {
      await onRefresh();
      setLastRefreshed(new Date());
    } catch (error) {
      console.error("Refresh failed:", error);
    } finally {
      setTimeout(() => {
        setIsRefreshing(false);
      }, 500);
    }
  };

  const toggleAutoRefresh = (enabled: boolean) => {
    setAutoRefresh(enabled);
    if (!enabled && timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  useEffect(() => {
    handleRefresh();

    if (autoRefresh) {
      timerRef.current = setInterval(handleRefresh, refreshInterval);
    }

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, [autoRefresh]);

  useEffect(() => {
    const handleKeyPress = (event: KeyboardEvent) => {
      if (
        event.key.toLowerCase() === keyboardShortcut.toLowerCase() &&
        !event.ctrlKey &&
        !event.metaKey
      ) {
        const now = Date.now();
        if (now - lastKeyPressRef.current >= rateLimitMs) {
          lastKeyPressRef.current = now;
          handleRefresh();
        }
      }
    };

    window.addEventListener("keydown", handleKeyPress);
    return () => window.removeEventListener("keydown", handleKeyPress);
  }, [keyboardShortcut, rateLimitMs]);

  const buttonContent = (
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
          {autoRefresh ? "Auto" : label}
        </span>
        {lastRefreshed && (
          <span className="ml-1.5 text-xs text-muted-foreground">
            {formatTime(lastRefreshed)}
          </span>
        )}
      </div>
    </div>
  );

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
                autoRefresh && "text-primary",
                className,
              )}
              aria-label={`${label} (Press ${keyboardShortcut})`}
            >
              {buttonContent}
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
              aria-label="Auto refresh settings"
            >
              <ChevronDown className="h-4 w-4" aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56 p-0">
            <div className="flex items-center justify-between rounded-t-md bg-muted/50 p-3">
              <div className="flex flex-col">
                <span className="text-sm font-medium">Auto refresh</span>
                <span className="text-xs text-muted-foreground">
                  (~ {refreshInterval / 1000}s)
                </span>
              </div>
              <Switch
                checked={autoRefresh}
                onCheckedChange={toggleAutoRefresh}
                className="data-[state=checked]:bg-primary data-[state=unchecked]:bg-muted-foreground/30"
                aria-label="Toggle auto refresh"
              />
            </div>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
