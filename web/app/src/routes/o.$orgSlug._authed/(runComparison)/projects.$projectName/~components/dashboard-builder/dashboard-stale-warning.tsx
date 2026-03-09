import { AlertTriangleIcon } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";

interface DashboardStaleWarningProps {
  onSaveAsNew: () => void;
  onOverride: () => void;
}

export function DashboardStaleWarning({
  onSaveAsNew,
  onOverride,
}: DashboardStaleWarningProps) {
  return (
    <Alert variant="warning" className="flex items-center gap-2 py-2.5">
      <AlertTriangleIcon className="size-4 shrink-0" />
      <AlertDescription className="flex flex-wrap items-center gap-x-1 text-sm">
        <span>The contents of this dashboard have been modified by another user.</span>
        <span>
          You can{" "}
          <button
            type="button"
            onClick={onSaveAsNew}
            className="font-medium underline underline-offset-2 hover:opacity-80"
          >
            save your changes as a new dashboard
          </button>
          , or{" "}
          <button
            type="button"
            onClick={onOverride}
            className="font-medium underline underline-offset-2 hover:opacity-80"
          >
            override the changes
          </button>
          .
        </span>
      </AlertDescription>
    </Alert>
  );
}
