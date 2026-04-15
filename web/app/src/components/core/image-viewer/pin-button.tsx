import { Pin, PinOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { PinSource } from "@/routes/o.$orgSlug._authed/(run)/projects.$projectName.$runId/~context/image-step-sync-context";

interface PinButtonProps {
  isPinned: boolean;
  currentStepValue: number;
  onPin: (scope: "local" | "all-panels") => void;
  onUnpin: (scope: "this-widget" | "all-widgets") => void;
  hasSyncContext: boolean;
  /** Source of the current pin (affects unpin menu behavior) */
  pinSource?: PinSource | null;
}

export function PinButton({
  isPinned,
  currentStepValue,
  onPin,
  onUnpin,
  hasSyncContext,
  pinSource,
}: PinButtonProps) {
  if (isPinned) {
    // Local pins only affect one widget — single unpin action
    if (pinSource === "local") {
      return (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 text-primary"
              data-testid="unpin-button"
              onClick={(e) => {
                e.stopPropagation();
                onUnpin("this-widget");
              }}
            >
              <PinOff className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Unpin this image</TooltipContent>
        </Tooltip>
      );
    }

    // Cross-panel or best-step pins → dropdown with 2 unpin options
    return (
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 text-primary"
                data-testid="unpin-button"
                onClick={(e) => e.stopPropagation()}
              >
                <PinOff className="h-3.5 w-3.5" />
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent>Unpin options</TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="start" className="min-w-[200px]">
          <DropdownMenuItem
            data-testid="unpin-menu-item-this-widget"
            onClick={() => onUnpin("this-widget")}
          >
            Unpin this image
          </DropdownMenuItem>
          <DropdownMenuItem
            data-testid="unpin-menu-item-all-panels"
            onClick={() => onUnpin("all-widgets")}
          >
            Unpin across all panels
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  if (hasSyncContext) {
    return (
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 text-muted-foreground hover:text-foreground"
                data-testid="pin-button"
                onClick={(e) => e.stopPropagation()}
              >
                <Pin className="h-3.5 w-3.5" />
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent>Pin at current step</TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="start" className="min-w-[180px]">
          <DropdownMenuItem
            data-testid="pin-menu-item-local"
            onClick={() => onPin("local")}
          >
            ◇ Pin step {currentStepValue} in this panel
          </DropdownMenuItem>
          <DropdownMenuItem
            data-testid="pin-menu-item-all-panels"
            onClick={() => onPin("all-panels")}
          >
            ◈ Pin step {currentStepValue} across all panels
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 text-muted-foreground hover:text-foreground"
          data-testid="pin-button"
          onClick={(e) => {
            e.stopPropagation();
            onPin("local");
          }}
        >
          <Pin className="h-3.5 w-3.5" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>Pin at step {currentStepValue}</TooltipContent>
    </Tooltip>
  );
}
