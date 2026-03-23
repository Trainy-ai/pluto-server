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

/** Approximate width per tag badge character + padding/margins */
const TAG_CHAR_WIDTH = 7;
const TAG_PADDING = 24; // badge horizontal padding + gap
const TAG_MAX_WIDTH = 120; // matches TagBadge max-w-[120px] truncate
const OVERFLOW_BADGE_WIDTH = 32; // "+N" badge width
const EDIT_BUTTON_WIDTH = 28; // pencil button

export function TagsCell({ tags, allTags, onTagsUpdate, organizationId }: TagsCellProps) {
  const [isHovered, setIsHovered] = useState(false);
  const [maxVisible, setMaxVisible] = useState(2);
  const containerRef = useRef<HTMLDivElement>(null);
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(leaveTimer.current), []);
  const onPointerEnter = useCallback(() => { clearTimeout(leaveTimer.current); setIsHovered(true); }, []);
  const onPointerLeave = useCallback(() => { leaveTimer.current = setTimeout(() => setIsHovered(false), 100); }, []);

  // Measure available width and compute how many tags fit
  useEffect(() => {
    const el = containerRef.current;
    if (!el || tags.length === 0) return;

    const compute = () => {
      const availableWidth = el.clientWidth - EDIT_BUTTON_WIDTH;
      let usedWidth = 0;
      let count = 0;

      for (let i = 0; i < tags.length; i++) {
        const tagWidth = Math.min(tags[i].length * TAG_CHAR_WIDTH + TAG_PADDING, TAG_MAX_WIDTH);
        const needsOverflow = i < tags.length - 1; // not the last tag
        const reserveForOverflow = needsOverflow ? OVERFLOW_BADGE_WIDTH : 0;

        if (usedWidth + tagWidth + reserveForOverflow <= availableWidth) {
          usedWidth += tagWidth;
          count++;
        } else {
          break;
        }
      }

      setMaxVisible(Math.max(1, count));
    };

    compute();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(compute);
    observer.observe(el);
    return () => observer.disconnect();
  }, [tags]);

  const visibleTags = tags.slice(0, maxVisible);
  const hiddenCount = tags.length - visibleTags.length;
  const hasOverflow = hiddenCount > 0;
  const hasLongTag = visibleTags.some((tag) => tag.length > 15);
  const showTooltip = hasOverflow || hasLongTag;

  return (
    <div ref={containerRef} className="flex items-center gap-1 overflow-hidden">
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
                +{hiddenCount}
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
