import { useState, useRef, useEffect, useCallback } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Pencil } from "lucide-react";
import { TagsEditorPopover } from "@/components/tags-editor-popover";
import { TagBadge } from "@/components/tag-badge";

interface TagsCellProps {
  tags: string[];
  allTags: string[];
  onTagsUpdate: (tags: string[]) => void;
  organizationId?: string;
}

const GAP_PX = 4; // gap-1 = 0.25rem = 4px
const EDIT_BUTTON_WIDTH = 28; // h-6 w-6 button + gap
const OVERFLOW_BADGE_WIDTH = 36; // approximate "+N" badge width

export function TagsCell({ tags, allTags, onTagsUpdate, organizationId }: TagsCellProps) {
  const [isHovered, setIsHovered] = useState(false);
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const outerRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const [visibleCount, setVisibleCount] = useState(tags.length > 0 ? 1 : 0);

  useEffect(() => () => clearTimeout(leaveTimer.current), []);
  const onPointerEnter = useCallback(() => { clearTimeout(leaveTimer.current); setIsHovered(true); }, []);
  const onPointerLeave = useCallback(() => { leaveTimer.current = setTimeout(() => setIsHovered(false), 100); }, []);

  // Dynamically compute how many tags fit in the available width
  useEffect(() => {
    const outer = outerRef.current;
    const measureEl = measureRef.current;
    if (!outer || !measureEl || tags.length === 0) return;

    function measure() {
      const outerEl = outerRef.current;
      const mEl = measureRef.current;
      if (!outerEl || !mEl) return;

      const availableWidth = outerEl.clientWidth - EDIT_BUTTON_WIDTH;
      const tagEls = Array.from(mEl.children) as HTMLElement[];

      let usedWidth = 0;
      let count = 0;

      for (let i = 0; i < tagEls.length; i++) {
        const w = tagEls[i].offsetWidth;
        const gapBefore = count > 0 ? GAP_PX : 0;
        const remaining = tagEls.length - i - 1;
        const overflowSpace = remaining > 0 ? OVERFLOW_BADGE_WIDTH + GAP_PX : 0;

        if (usedWidth + gapBefore + w + overflowSpace <= availableWidth) {
          usedWidth += gapBefore + w;
          count++;
        } else {
          break;
        }
      }

      setVisibleCount(Math.max(count, 1));
    }

    measure(); // Perform an initial measurement

    const observer = new ResizeObserver(measure);
    observer.observe(outer);
    return () => observer.disconnect();
  }, [tags]);

  const visibleTags = tags.slice(0, visibleCount);
  const hasOverflow = tags.length > visibleCount;
  const hasLongTag = visibleTags.some((tag) => tag.length > 15);
  const showTooltip = hasOverflow || hasLongTag;

  return (
    <div ref={outerRef} className="relative flex items-center gap-1 overflow-hidden">
      {/* Hidden measurement row — renders all tags so we can measure their widths */}
      <div
        ref={measureRef}
        className="pointer-events-none invisible absolute flex items-center gap-1"
        aria-hidden="true"
      >
        {tags.map((tag) => (
          <TagBadge key={tag} tag={tag} truncate />
        ))}
      </div>

      <Tooltip open={isHovered}>
        <TooltipTrigger asChild>
          <div
            className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden cursor-default"
            onPointerEnter={onPointerEnter}
            onPointerLeave={onPointerLeave}
          >
            {visibleTags.map((tag) => (
              <TagBadge key={tag} tag={tag} truncate />
            ))}
            {hasOverflow && (
              <Badge variant="outline" className="text-xs bg-primary/10 shrink-0">
                +{tags.length - visibleCount}
              </Badge>
            )}
          </div>
        </TooltipTrigger>
        {showTooltip && (
          <TooltipContent
            side="top"
            className="max-w-80 border border-border bg-accent shadow-lg"
            onPointerEnter={onPointerEnter}
            onPointerLeave={onPointerLeave}
          >
            <div className="flex flex-wrap gap-1">
              {tags.map((tag) => (
                <TagBadge key={tag} tag={tag} truncate className="max-w-[180px]" />
              ))}
            </div>
          </TooltipContent>
        )}
      </Tooltip>
      <TagsEditorPopover
        tags={tags}
        allTags={allTags}
        onTagsUpdate={onTagsUpdate}
        organizationId={organizationId}
        stopPropagation
        trigger={
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 shrink-0"
            onClick={(e) => e.stopPropagation()}
            title="Edit tags"
          >
            <Pencil className="h-3 w-3" />
          </Button>
        }
      />
    </div>
  );
}
