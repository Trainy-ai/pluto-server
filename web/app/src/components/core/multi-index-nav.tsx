import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface MultiIndexNavProps {
  currentIndex: number;
  totalCount: number;
  onIndexChange: (next: number) => void;
  className?: string;
}

export function MultiIndexNav({
  currentIndex,
  totalCount,
  onIndexChange,
  className,
}: MultiIndexNavProps) {
  if (totalCount <= 1) return null;

  const atStart = currentIndex <= 0;
  const atEnd = currentIndex >= totalCount - 1;

  return (
    <div
      className={cn("flex items-center justify-center gap-2", className)}
      data-testid="multi-index-nav"
    >
      <Button
        variant="ghost"
        size="icon"
        className="h-6 w-6"
        disabled={atStart}
        onClick={(e) => {
          e.stopPropagation();
          onIndexChange(currentIndex - 1);
        }}
        data-testid="multi-index-prev"
      >
        <ChevronLeft className="h-4 w-4" />
      </Button>
      <span
        className="min-w-[3ch] text-center font-mono text-xs tabular-nums text-muted-foreground"
        data-testid="multi-index-label"
      >
        {currentIndex + 1} / {totalCount}
      </span>
      <Button
        variant="ghost"
        size="icon"
        className="h-6 w-6"
        disabled={atEnd}
        onClick={(e) => {
          e.stopPropagation();
          onIndexChange(currentIndex + 1);
        }}
        data-testid="multi-index-next"
      >
        <ChevronRight className="h-4 w-4" />
      </Button>
    </div>
  );
}
