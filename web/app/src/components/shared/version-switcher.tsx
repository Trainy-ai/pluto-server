import * as React from "react";
import { CheckIcon, HistoryIcon } from "lucide-react";

import {
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuPortal,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { useFrontendVersions } from "@/hooks/use-frontend-versions";
import {
  getPinnedVersion,
  pinVersion,
  unpinVersion,
  buildClearCookie,
} from "@/lib/frontend-version";
import { cn } from "@/lib/utils";

/**
 * Lets the user pin the frontend to a previously released build (or return to
 * latest). Renders nothing unless the deployment ships more than one build, so
 * it is invisible in dev and on single-build images. Designed to live inside
 * the user dropdown menu (see user-details.tsx).
 */
export function VersionSwitcher(): React.JSX.Element | null {
  const manifest = useFrontendVersions();
  const rawPinned = getPinnedVersion();

  // Reconcile a stale pin: if the cookie names a build no longer baked into the
  // image, nginx already falls back to the current bundle, so clear the dead
  // cookie to keep the cookie, the served bundle, and the UI in agreement.
  React.useEffect(() => {
    if (
      manifest &&
      rawPinned &&
      !manifest.versions.includes(rawPinned) &&
      typeof document !== "undefined"
    ) {
      document.cookie = buildClearCookie();
    }
  }, [manifest, rawPinned]);

  // Nothing to switch between — hide entirely.
  if (!manifest || manifest.versions.length < 2) {
    return null;
  }

  const { current, versions } = manifest;
  // A pin only counts if its build is actually still served; a stale pin is
  // treated as "latest" so the UI never claims an older build that isn't loaded.
  const pinned = rawPinned && versions.includes(rawPinned) ? rawPinned : null;
  const activeVersion = pinned ?? current;

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger className="cursor-pointer">
        <HistoryIcon className="mr-2 h-4 w-4" />
        <span className="flex-1">Frontend version</span>
        <span className="ml-2 truncate text-xs text-muted-foreground">
          {pinned ? pinned : "latest"}
        </span>
      </DropdownMenuSubTrigger>
      <DropdownMenuPortal>
        <DropdownMenuSubContent className="w-56 bg-background">
          {versions.map((version) => {
            const isLatest = version === current;
            const isActive = version === activeVersion;
            return (
              <DropdownMenuItem
                key={version}
                className="cursor-pointer"
                onClick={() => {
                  if (isActive) {
                    return;
                  }
                  // Clearing the pin (rather than pinning the newest version
                  // explicitly) keeps users on "latest" as it advances.
                  if (isLatest) {
                    unpinVersion();
                  } else {
                    pinVersion(version);
                  }
                }}
              >
                <CheckIcon
                  className={cn(
                    "mr-2 h-4 w-4",
                    isActive ? "opacity-100" : "opacity-0",
                  )}
                />
                <span className="flex-1 truncate">{version}</span>
                {isLatest ? (
                  <span className="ml-2 text-xs text-muted-foreground">
                    latest
                  </span>
                ) : null}
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuSubContent>
      </DropdownMenuPortal>
    </DropdownMenuSub>
  );
}
