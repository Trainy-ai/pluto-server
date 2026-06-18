import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tag } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { TagsEditorPopover } from "@/components/tags-editor-popover";
import { TagBadge } from "@/components/tag-badge";

interface RunTagsProps {
  tags: string[];
  onTagsUpdate: (tags: string[]) => void;
  organizationId?: string;
  projectName?: string;
}

// Cap how many tags render inline in the run header. Extra tags collapse into a
// "+N" badge, and a tooltip lists every tag. The header bar is a fixed height,
// so without this cap a run with many tags wraps to a second line and gets
// clipped. Tags are kept on a single, non-wrapping row.
const MAX_VISIBLE_TAGS = 5;

export function RunTags({ tags, onTagsUpdate, organizationId, projectName }: RunTagsProps) {
  const visibleTags = tags.slice(0, MAX_VISIBLE_TAGS);
  const overflowCount = tags.length - visibleTags.length;
  const hasOverflow = overflowCount > 0;
  const hasLongTag = visibleTags.some((tag) => tag.length > 15);
  const showTooltip = hasOverflow || hasLongTag;

  const tagsList = (
    <div className="flex items-center gap-1" data-testid="run-tags-list">
      {visibleTags.map((tag) => (
        // max-w caps every badge type (incl. linear/baseline integration
        // badges, which ignore the `truncate` prop) so a long tag can't
        // grow the single header row and crowd neighboring controls.
        <TagBadge key={tag} tag={tag} truncate className="max-w-[200px]" />
      ))}
      {hasOverflow && (
        <Badge
          variant="outline"
          className="shrink-0 bg-primary/10 text-xs"
          data-testid="run-tags-overflow"
        >
          +{overflowCount}
        </Badge>
      )}
    </div>
  );

  return (
    <div className="flex items-center gap-2">
      {tags.length === 0 ? (
        <span className="text-sm text-muted-foreground">No tags</span>
      ) : showTooltip ? (
        // Only wrap in a Tooltip when there's something to reveal (overflow or a
        // truncated tag) — an empty TooltipTrigger would mislead screen readers.
        <Tooltip>
          <TooltipTrigger asChild>{tagsList}</TooltipTrigger>
          <TooltipContent
            side="bottom"
            className="max-w-80 border border-border bg-accent shadow-lg"
          >
            <div className="flex flex-wrap gap-1">
              {tags.map((tag) => (
                <TagBadge key={tag} tag={tag} truncate className="max-w-[180px]" />
              ))}
            </div>
          </TooltipContent>
        </Tooltip>
      ) : (
        tagsList
      )}
      <TagsEditorPopover
        tags={tags}
        onTagsUpdate={onTagsUpdate}
        organizationId={organizationId}
        projectName={projectName}
        emptyText="No tags found. Type to create a new tag."
        trigger={
          <Button variant="ghost" size="sm" className="h-7 gap-1" data-testid="run-tags-edit">
            <Tag className="h-3 w-3" />
            <span className="text-xs">Edit Tags</span>
          </Button>
        }
      />
    </div>
  );
}
