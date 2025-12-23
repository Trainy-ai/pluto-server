import { Input } from "@/components/ui/input";
import { Search, X, Code2, Text } from "lucide-react";
import { useCallback, useState, useRef, memo } from "react";
import { useDebouncedCallback } from "@/lib/hooks/use-debounced-callback";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface LogSearchProps {
  onSearch: (value: string, isRegex: boolean) => void;
  placeholder?: string;
}

function isValidRegex(pattern: string) {
  try {
    new RegExp(pattern);
    return true;
  } catch (e) {
    return false;
  }
}

export const LogSearch = memo(function LogSearch({
  onSearch,
  placeholder = "Search logs...",
}: LogSearchProps) {
  const [localValue, setLocalValue] = useState("");
  const [isRegexMode, setIsRegexMode] = useState(false);
  const [isInvalidRegex, setIsInvalidRegex] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const debouncedSearch = useDebouncedCallback(
    (value: string) => {
      if (isRegexMode) {
        const isValid = isValidRegex(value);
        setIsInvalidRegex(!isValid);
        if (isValid) {
          onSearch(value, true);
        }
      } else {
        onSearch(value, false);
      }
    },
    150, // Debounce time
    { maxWait: 500 }, // Maximum wait time
  );

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const newValue = e.target.value;
      setLocalValue(newValue);
      debouncedSearch(newValue);
    },
    [debouncedSearch],
  );

  const handleClear = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      setLocalValue("");
      setIsInvalidRegex(false);
      onSearch("", isRegexMode);
      debouncedSearch.cancel();
      inputRef.current?.focus();
    },
    [onSearch, debouncedSearch, isRegexMode],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // Clear on Escape
      if (e.key === "Escape" && localValue) {
        e.preventDefault();
        setLocalValue("");
        setIsInvalidRegex(false);
        onSearch("", isRegexMode);
        debouncedSearch.cancel();
      }
    },
    [localValue, onSearch, debouncedSearch, isRegexMode],
  );

  const toggleRegexMode = useCallback(() => {
    setIsRegexMode((prev) => {
      const newMode = !prev;
      // Clear invalid state when switching to normal mode
      if (!newMode) {
        setIsInvalidRegex(false);
      } else if (localValue) {
        // Check if current value is valid regex when switching to regex mode
        setIsInvalidRegex(!isValidRegex(localValue));
      }
      // Update search with new mode
      onSearch(localValue, newMode);
      return newMode;
    });
  }, [localValue, onSearch]);

  return (
    <div className="flex w-full max-w-full items-center gap-2">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="outline"
            size="icon"
            onClick={toggleRegexMode}
            className={`shrink-0 ${isRegexMode ? "bg-accent" : ""}`}
            aria-label="Toggle regex mode"
          >
            {isRegexMode ? (
              <Text className="h-4 w-4" />
            ) : (
              <Code2 className="h-4 w-4" />
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <p>
            {isRegexMode ? "Switch to normal search" : "Switch to regex search"}
          </p>
        </TooltipContent>
      </Tooltip>
      <div className="relative min-w-0 flex-1">
        <Search className="pointer-events-none absolute top-2.5 left-2 h-4 w-4 text-muted-foreground" />
        <Input
          ref={inputRef}
          placeholder={isRegexMode ? "Search with regex..." : placeholder}
          value={localValue}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          className={`w-full pr-8 pl-8 ${isInvalidRegex ? "border-destructive" : ""}`}
        />
        {localValue && (
          <button
            type="button"
            onClick={handleClear}
            className="absolute top-2.5 right-2 text-muted-foreground hover:text-foreground"
            aria-label="Clear search"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
});
