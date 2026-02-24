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
  const visibleTags = tags.slice(0, 2);
  const hasOverflow = tags.length > 2;

  return (
    <div className="flex items-center gap-1 overflow-hidden">
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden cursor-default">
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
        <TooltipContent side="top" className="max-w-64">
          <div className="flex flex-wrap gap-1">
            {tags.map((tag) => (
              <TagBadge key={tag} tag={tag} />
            ))}
          </div>
        </TooltipContent>
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
