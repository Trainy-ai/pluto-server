import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Code2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { makeRegexValue } from "./glob-utils";
import { MetricResultsList } from "./metric-results-list";

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
  return (
    <div className="space-y-3">
      <div className="grid gap-2">
        <Label>Regex Pattern</Label>
        <Input
          placeholder="e.g., (train|eval)/.+, .*loss.*"
          value={regexPattern}
          onChange={(e) => onRegexChange(e.target.value)}
          className={cn(isInvalidRegex && "border-destructive text-destructive")}
        />
      </div>

      {regexPattern.trim() && !isInvalidRegex && (
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

      {isInvalidRegex && regexPattern.trim() && (
        <p className="text-xs text-destructive">Invalid regex pattern.</p>
      )}
    </div>
  );
}
