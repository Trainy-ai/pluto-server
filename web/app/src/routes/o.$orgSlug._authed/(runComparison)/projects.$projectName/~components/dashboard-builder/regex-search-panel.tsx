import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Code2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { makeRegexValue } from "./glob-utils";
import { MetricResultsList } from "./metric-results-list";

/** Maximum regex pattern length accepted by the server */
export const REGEX_MAX_LENGTH = 500;

/** Regex panel — server-side regex search with inline results.
 *  Shared by ChartConfigForm and FilesConfigForm. */
export function RegexSearchPanel({
  regexPattern,
  onRegexChange,
  isInvalidRegex,
  isRegexSearching,
  regexMetrics,
  selectedValues,
  onToggle,
  onSelectAll,
  onApplyDynamic,
  itemLabel = "metric",
}: {
  regexPattern: string;
  onRegexChange: (v: string) => void;
  isInvalidRegex: boolean;
  isRegexSearching: boolean;
  regexMetrics: string[];
  selectedValues: string[];
  onToggle: (metric: string) => void;
  onSelectAll: () => void;
  onApplyDynamic: () => void;
  itemLabel?: string;
}) {
  const isTooLong = regexPattern.length > REGEX_MAX_LENGTH;
  const isNearLimit = regexPattern.length > REGEX_MAX_LENGTH * 0.8;
  const hasError = isInvalidRegex || isTooLong;

  return (
    <div className="space-y-3">
      <div className="grid gap-2">
        <div className="flex items-center justify-between">
          <Label>Regex Pattern</Label>
          {isNearLimit && (
            <span className={cn("text-xs", isTooLong ? "text-destructive" : "text-muted-foreground")}>
              {regexPattern.length}/{REGEX_MAX_LENGTH}
            </span>
          )}
        </div>
        <Input
          placeholder="e.g., (train|eval)/.+, .*loss.*"
          value={regexPattern}
          onChange={(e) => onRegexChange(e.target.value)}
          className={cn(hasError && "border-destructive text-destructive")}
        />
      </div>

      {regexPattern.trim() && !hasError && (
        <MetricResultsList
          metrics={regexMetrics}
          selectedValues={selectedValues}
          isLoading={isRegexSearching}
          emptyMessage={`No ${itemLabel}s match this pattern.`}
          onToggle={onToggle}
          onSelectAll={onSelectAll}
          itemLabel={itemLabel}

          footer={
            regexMetrics.length > 0 ? (
              <div className="flex items-center gap-2 border-t px-3 py-2">
                <Code2 className="size-3 shrink-0 text-muted-foreground" />
                <span className="flex-1 text-xs text-muted-foreground">Apply as dynamic pattern</span>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 px-3 text-xs"
                  onClick={onApplyDynamic}
                  disabled={selectedValues.includes(makeRegexValue(regexPattern.trim()))}
                >
                  {selectedValues.includes(makeRegexValue(regexPattern.trim())) ? "Applied" : "Apply"}
                </Button>
              </div>
            ) : undefined
          }
        />
      )}

      {isTooLong && (
        <p className="text-xs text-destructive">
          Pattern too long ({regexPattern.length}/{REGEX_MAX_LENGTH} characters).
        </p>
      )}

      {isInvalidRegex && !isTooLong && regexPattern.trim() && (
        <p className="text-xs text-destructive">
          Invalid regex pattern. ClickHouse uses re2 — lookaheads, backreferences, and unbalanced parentheses are not supported.
        </p>
      )}
    </div>
  );
}
