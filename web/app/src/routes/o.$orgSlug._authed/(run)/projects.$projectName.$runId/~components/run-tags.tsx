import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tag } from "lucide-react";
import { TagsEditorPopover } from "@/components/tags-editor-popover";

interface RunTagsProps {
  tags: string[];
  onTagsUpdate: (tags: string[]) => void;
}

export function RunTags({ tags, onTagsUpdate }: RunTagsProps) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex flex-wrap items-center gap-1">
        {tags.length === 0 && (
          <span className="text-sm text-muted-foreground">No tags</span>
        )}
        {tags.map((tag) => (
          <Badge key={tag} variant="secondary" className="text-xs">
            {tag}
          </Badge>
        ))}
      </div>
      <TagsEditorPopover
        tags={tags}
        onTagsUpdate={onTagsUpdate}
        emptyText="No tags found. Type to create a new tag."
        trigger={
          <Button variant="ghost" size="sm" className="h-7 gap-1">
            <Tag className="h-3 w-3" />
            <span className="text-xs">Edit Tags</span>
          </Button>
        }
      />
    </div>
  );
}
