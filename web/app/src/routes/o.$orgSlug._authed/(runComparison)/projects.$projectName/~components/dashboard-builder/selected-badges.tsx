import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { SparklesIcon, Code2 } from "lucide-react";
import { isGlobValue, getGlobPattern, isRegexValue, getRegexPattern } from "./glob-utils";

/** Shared badge strip for selected metrics/files, used by both config forms. */
export function SelectedBadges({
  values,
  onRemove,
}: {
  values: string[];
  onRemove: (value: string) => void;
}) {
  if (values.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1">
      {values.slice(0, 8).map((v) => {
        const isGlobVal = isGlobValue(v);
        const isRegex = isRegexValue(v);
        const isDynamic = isGlobVal || isRegex;
        return (
          <Badge
            key={v}
            variant={isDynamic ? "default" : "secondary"}
            className={cn(
              "max-w-[220px] cursor-pointer text-xs",
              isDynamic && "bg-primary/90 text-primary-foreground"
            )}
            title={isGlobVal ? getGlobPattern(v) : isRegex ? getRegexPattern(v) : v}
            onClick={() => onRemove(v)}
          >
            {isGlobVal && <SparklesIcon className="mr-1 size-3 shrink-0" />}
            {isRegex && <Code2 className="mr-1 size-3 shrink-0" />}
            <span className="truncate">{isGlobVal ? getGlobPattern(v) : isRegex ? getRegexPattern(v) : v}</span>
            <span className="ml-1 shrink-0">&times;</span>
          </Badge>
        );
      })}
      {values.length > 8 && (
        <Badge variant="outline" className="text-xs">
          +{values.length - 8} more
        </Badge>
      )}
    </div>
  );
}
