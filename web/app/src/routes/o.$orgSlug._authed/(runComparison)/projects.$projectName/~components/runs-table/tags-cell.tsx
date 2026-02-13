import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
  return (
    <div className="flex items-center gap-1 overflow-hidden">
      <div className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">
        {tags.slice(0, 2).map((tag) => (
          <TagBadge key={tag} tag={tag} truncate />
        ))}
        {tags.length > 2 && (
          <Badge variant="outline" className="shrink-0 text-xs bg-primary/10">
            +{tags.length - 2}
          </Badge>
        )}
      </div>
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
