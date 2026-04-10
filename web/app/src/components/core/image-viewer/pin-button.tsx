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

interface PinButtonProps {
  isPinned: boolean;
  currentStepValue: number;
  onPin: (scope: "local" | "all-panels") => void;
  onUnpin: () => void;
  hasSyncContext: boolean;
}

export function PinButton({
  isPinned,
  currentStepValue,
  onPin,
  onUnpin,
  hasSyncContext,
}: PinButtonProps) {
  if (isPinned) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-primary"
            onClick={(e) => {
              e.stopPropagation();
              onUnpin();
            }}
          >
            <PinOff className="h-3.5 w-3.5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Unpin this run</TooltipContent>
      </Tooltip>
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
                onClick={(e) => e.stopPropagation()}
              >
                <Pin className="h-3.5 w-3.5" />
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent>Pin at current step</TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="start" className="min-w-[180px]">
          <DropdownMenuItem onClick={() => onPin("local")}>
            ◇ Pin step {currentStepValue} in this panel
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => onPin("all-panels")}>
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
