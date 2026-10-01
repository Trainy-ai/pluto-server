import { SparklesIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useIsCopilotSuppressed } from "./copilot-dock";
import { useCopilotActions, useCopilotState } from "./copilot-provider";

/** Header button that opens and closes the copilot panel. */
export function CopilotToggle() {
  const state = useCopilotState();
  const actions = useCopilotActions();
  const isSuppressed = useIsCopilotSuppressed();
  if (!state || !actions || isSuppressed) return null;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant={state.isOpen ? "secondary" : "outline"}
          size="icon"
          className="size-9"
          onClick={() => actions.setOpen((open) => !open)}
          aria-label={state.isOpen ? "Close copilot" : "Open copilot"}
          aria-pressed={state.isOpen}
          data-testid="copilot-toggle"
        >
          <SparklesIcon className="size-4" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>Copilot</TooltipContent>
    </Tooltip>
  );
}
