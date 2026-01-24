import { env } from "@/lib/env";
import { useSidebar } from "@/components/ui/sidebar";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface VersionIndicatorProps {
  className?: string;
}

export function VersionIndicator({ className }: VersionIndicatorProps) {
  const { state } = useSidebar();
  const isCollapsed = state === "collapsed";

  const version = env.SERVICE_VERSION;
  const commit = env.GIT_COMMIT;
  const branch = env.GIT_BRANCH;
  const buildTime = env.BUILD_TIME;

  // Format commit to short version (7 chars)
  const shortCommit = commit !== "unknown" ? commit.slice(0, 7) : "unknown";

  // Format version display
  const versionDisplay =
    version === "unknown"
      ? ""
      : version === "dev"
        ? "dev"
        : `v${version}`;

  // Don't show anything if we have no version info
  if (version === "unknown" && commit === "unknown") {
    return null;
  }

  const fullInfo = (
    <div className="space-y-1 text-xs">
      {version !== "unknown" && (
        <div>
          <span className="text-muted-foreground">Version:</span>{" "}
          <span className="font-mono">{version}</span>
        </div>
      )}
      {commit !== "unknown" && (
        <div>
          <span className="text-muted-foreground">Commit:</span>{" "}
          <span className="font-mono">{commit}</span>
        </div>
      )}
      {branch !== "unknown" && (
        <div>
          <span className="text-muted-foreground">Branch:</span>{" "}
          <span className="font-mono">{branch}</span>
        </div>
      )}
      {buildTime !== "unknown" && (
        <div>
          <span className="text-muted-foreground">Built:</span>{" "}
          <span className="font-mono">
            {new Date(buildTime).toLocaleString()}
          </span>
        </div>
      )}
    </div>
  );

  if (isCollapsed) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <div
              className={`flex items-center justify-center px-3 py-2 text-xs text-muted-foreground ${className}`}
            >
              <span className="font-mono">{shortCommit.slice(0, 3)}</span>
            </div>
          </TooltipTrigger>
          <TooltipContent side="right" sideOffset={10}>
            {fullInfo}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div
            className={`flex items-center gap-1.5 px-3 py-2 text-xs text-muted-foreground ${className}`}
          >
            {versionDisplay && (
              <span className="font-mono">{versionDisplay}</span>
            )}
            {versionDisplay && commit !== "unknown" && (
              <span className="text-muted-foreground/50">·</span>
            )}
            {commit !== "unknown" && (
              <span className="font-mono text-muted-foreground/70">
                {shortCommit}
              </span>
            )}
          </div>
        </TooltipTrigger>
        <TooltipContent side="right" sideOffset={10}>
          {fullInfo}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
