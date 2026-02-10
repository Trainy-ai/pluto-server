import { useState, useRef, useEffect } from "react";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";

interface NotesCellProps {
  notes: string | null;
  onNotesUpdate: (notes: string | null) => void;
}

export function NotesCell({ notes, onNotesUpdate }: NotesCellProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [draft, setDraft] = useState(notes ?? "");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Sync draft with prop when popover opens
  useEffect(() => {
    if (isOpen) {
      setDraft(notes ?? "");
      // Focus textarea after popover opens
      setTimeout(() => textareaRef.current?.focus(), 0);
    }
  }, [isOpen, notes]);

  function handleSave() {
    const trimmed = draft.trim();
    onNotesUpdate(trimmed || null);
    setIsOpen(false);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // Cmd/Ctrl+Enter to save
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSave();
    }
    // Escape to cancel
    if (e.key === "Escape") {
      setIsOpen(false);
    }
  }

  return (
    <div className="flex items-center gap-1">
      {notes ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="flex-1 truncate text-sm text-muted-foreground">
              {notes}
            </span>
          </TooltipTrigger>
          <TooltipContent side="top" sideOffset={4}>
            <p className="max-w-xs whitespace-pre-wrap">{notes}</p>
          </TooltipContent>
        </Tooltip>
      ) : (
        <span className="flex-1" />
      )}
      <Popover open={isOpen} onOpenChange={setIsOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 shrink-0"
            onClick={(e) => e.stopPropagation()}
            title="Edit notes"
          >
            <Pencil className="h-3 w-3" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          className="w-72 p-3"
          side="right"
          align="start"
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <div className="flex flex-col gap-2">
            <label className="text-xs font-medium text-muted-foreground">
              Notes
            </label>
            <Textarea
              ref={textareaRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Add a note about this run..."
              className="min-h-[80px] resize-none text-sm"
              maxLength={1000}
            />
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">
                {draft.length}/1000
              </span>
              <div className="flex gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setIsOpen(false)}
                >
                  Cancel
                </Button>
                <Button size="sm" onClick={handleSave}>
                  Save
                </Button>
              </div>
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
