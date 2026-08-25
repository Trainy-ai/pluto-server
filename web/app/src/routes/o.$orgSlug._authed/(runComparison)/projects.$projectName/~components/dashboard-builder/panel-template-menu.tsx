// "Templates" dropdown for the Python panel editor: the built-in
// starter-template gallery (lib/panels/panel-templates.ts). Selecting a
// template replaces the current DRAFT (code + requirements) — guarded by
// a confirm dialog when the draft has unsaved edits. Applying a template
// never touches the saved widget until the user hits Save.

import { useState } from "react";
import { AlertTriangleIcon, ChevronDownIcon, LayoutTemplateIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PANEL_TEMPLATES, type PanelTemplate } from "@/lib/panels/panel-templates";

interface PanelTemplateMenuProps {
  /** True when the draft differs from the widget's saved/initial state. */
  isDirty: boolean;
  onApply: (template: PanelTemplate) => void;
}

export function PanelTemplateMenu({ isDirty, onApply }: PanelTemplateMenuProps) {
  const [pendingTemplate, setPendingTemplate] = useState<PanelTemplate | null>(
    null,
  );

  const handleSelect = (template: PanelTemplate) => {
    if (isDirty) {
      setPendingTemplate(template);
    } else {
      onApply(template);
    }
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="h-7 gap-1.5 text-xs"
            data-testid="panel-template-menu"
          >
            <LayoutTemplateIcon className="size-3.5" />
            Templates
            <ChevronDownIcon className="size-3" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-72">
          {PANEL_TEMPLATES.map((template) => (
            <DropdownMenuItem
              key={template.id}
              className="flex flex-col items-start gap-0.5"
              data-testid={`panel-template-${template.id}`}
              onClick={() => handleSelect(template)}
            >
              <span className="text-sm font-medium">{template.name}</span>
              <span className="text-xs text-muted-foreground">
                {template.description}
              </span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog
        open={pendingTemplate !== null}
        onOpenChange={(open) => {
          if (!open) {
            setPendingTemplate(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangleIcon className="size-5 text-yellow-500" />
              Replace draft with template?
            </DialogTitle>
            <DialogDescription>
              Loading “{pendingTemplate?.name}” replaces your current code and
              packages. Your unsaved edits will be lost.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setPendingTemplate(null)}
              data-testid="panel-template-replace-cancel"
            >
              Keep My Code
            </Button>
            <Button
              variant="destructive"
              data-testid="panel-template-replace-confirm"
              onClick={() => {
                if (pendingTemplate) {
                  onApply(pendingTemplate);
                }
                setPendingTemplate(null);
              }}
            >
              Replace Draft
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
