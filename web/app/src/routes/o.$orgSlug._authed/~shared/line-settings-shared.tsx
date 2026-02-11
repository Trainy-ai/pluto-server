import React from "react";
import { Button } from "@/components/ui/button";
import { Info, ExternalLink } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

const PREFERENCE_LOGS = ["epoch", "step", "time"];

export function getLogNames(logs: string[]) {
  const data: string[] = ["Step", "Absolute Time", "Relative Time"];
  const secondaryLogs: string[] = [];
  for (const log of logs) {
    if (log.startsWith("sys/")) {
      continue;
    }

    if (PREFERENCE_LOGS.some((prefLog) => log.includes(prefLog))) {
      data.push(log);
    } else {
      secondaryLogs.push(log);
    }
  }
  return {
    primaryLogs: data,
    secondaryLogs,
  };
}

interface InfoTooltipProps {
  title: string;
  description: React.ReactNode;
  link?: {
    url: string;
    label: string;
  };
}

export const InfoTooltip = ({ title, description, link }: InfoTooltipProps) => (
  <Tooltip>
    <TooltipTrigger asChild>
      <Button
        variant="ghost"
        size="icon"
        className="h-5 w-5 rounded-full transition-colors hover:bg-muted/60"
      >
        <Info className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="sr-only">Info</span>
      </Button>
    </TooltipTrigger>
    <TooltipContent className="w-80 rounded-lg border-muted p-4 text-sm shadow-lg">
      <div className="flex flex-col space-y-2">
        <h4 className="font-semibold text-primary">{title}</h4>
        <p className="text-xs leading-relaxed text-muted-foreground">
          {description}
        </p>
        {link && (
          <a
            href={link.url}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-1 flex items-center gap-1 text-xs text-blue-500 transition-colors hover:text-blue-700 hover:underline"
          >
            {link.label}
            <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </div>
    </TooltipContent>
  </Tooltip>
);

export const SettingsSection = ({
  title,
  children,
  description,
}: {
  title: string;
  children: React.ReactNode;
  description?: React.ReactNode;
}) => (
  <div className="space-y-4 rounded-lg bg-background transition-all">
    <div className="flex items-center gap-2">
      <h3 className="text-sm font-medium text-primary">{title}</h3>
    </div>
    {description && (
      <p className="-mt-2 text-xs text-muted-foreground">{description}</p>
    )}
    <div className="space-y-4 pl-1">{children}</div>
  </div>
);
