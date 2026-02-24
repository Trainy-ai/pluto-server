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

export function TagsCell({ tags, allTags, onTagsUpdate, organizationId }: TagsCellProps) {
  // Controlled hover state — bypasses Radix Tooltip's scroll-based dismissal
  // which fires when the data-table container emits layout-driven scroll events.
  const [isHovered, setIsHovered] = useState(false);
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(leaveTimer.current), []);
  const onPointerEnter = useCallback(() => { clearTimeout(leaveTimer.current); setIsHovered(true); }, []);
  const onPointerLeave = useCallback(() => { leaveTimer.current = setTimeout(() => setIsHovered(false), 100); }, []);
  const visibleTags = tags.slice(0, 2);
  const hasOverflow = tags.length > 2;

  return (
    <div className="flex items-center gap-1 overflow-hidden">
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
                +{tags.length - 2}
              </Badge>
            )}
          </div>
        </TooltipTrigger>
        {hasOverflow && (
          <TooltipContent
            side="top"
            className="max-w-64"
            onPointerEnter={onPointerEnter}
            onPointerLeave={onPointerLeave}
          >
            <div className="flex flex-wrap gap-1">
              {tags.map((tag) => (
                <TagBadge key={tag} tag={tag} />
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
