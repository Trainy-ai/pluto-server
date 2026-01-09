import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Pencil } from "lucide-react";
import { TagsEditorPopover } from "@/components/tags-editor-popover";

interface TagsCellProps {
  tags: string[];
  allTags: string[];
  onTagsUpdate: (tags: string[]) => void;
}

export function TagsCell({ tags, allTags, onTagsUpdate }: TagsCellProps) {
  return (
    <div className="flex items-center gap-1">
      <div className="flex flex-wrap items-center gap-1 overflow-hidden">
        {tags.slice(0, 2).map((tag) => (
          <Badge
            key={tag}
            variant="secondary"
            className="max-w-[80px] truncate text-xs"
          >
            {tag}
          </Badge>
        ))}
        {tags.length > 2 && (
          <Badge variant="outline" className="text-xs">
            +{tags.length - 2}
          </Badge>
        )}
      </div>
      <TagsEditorPopover
        tags={tags}
        allTags={allTags}
        onTagsUpdate={onTagsUpdate}
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
