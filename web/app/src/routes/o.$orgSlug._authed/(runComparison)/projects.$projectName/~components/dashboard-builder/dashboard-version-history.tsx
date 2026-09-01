import { format } from "date-fns";
import { HistoryIcon, LoaderCircleIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import {
  formatDashboardVersionActor,
  getDashboardVersionBadges,
} from "./dashboard-version-history-format";
import { useDashboardVersions } from "../../~queries/dashboard-views";

export function DashboardVersionHistory({
  open,
  onOpenChange,
  organizationId,
  viewId,
  selectedVersion,
  onSelectVersion,
}: DashboardVersionHistoryProps) {
  const versionsQuery = useDashboardVersions(
    organizationId,
    open ? viewId : null,
  );
  const versions =
    versionsQuery.data?.pages.flatMap((page) => page.versions) ?? [];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col p-0 sm:max-w-md">
        <SheetHeader className="border-b px-6 py-5 pr-12">
          <SheetTitle className="flex items-center gap-2">
            <HistoryIcon className="size-5" />
            Dashboard history
          </SheetTitle>
          <SheetDescription>
            Preview any saved version or restore it as a new current version.
          </SheetDescription>
        </SheetHeader>

        <ScrollArea className="min-h-0 flex-1">
          <div className="space-y-2 p-4">
            {versionsQuery.isPending && (
              <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
                <LoaderCircleIcon className="size-4 animate-spin" />
                Loading history…
              </div>
            )}

            {versionsQuery.isError && (
              <div className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
                Couldn&apos;t load dashboard history.{" "}
                {versionsQuery.error.message}
              </div>
            )}

            {versionsQuery.data && versions.length === 0 && (
              <div className="py-12 text-center text-sm text-muted-foreground">
                No saved versions yet.
              </div>
            )}

            {versions.map((version) => {
              const isSelected = selectedVersion
                ? selectedVersion === version.version
                : version.isCurrent;

              return (
                <Button
                  key={version.version}
                  type="button"
                  variant="ghost"
                  className={cn(
                    "h-auto w-full items-start justify-start rounded-lg border p-4 text-left whitespace-normal",
                    isSelected
                      ? "border-primary bg-primary/5 hover:bg-primary/10"
                      : "hover:bg-muted/60",
                  )}
                  aria-current={isSelected ? "true" : undefined}
                  onClick={() => onSelectVersion(version.version)}
                >
                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-semibold">v{version.version}</span>
                      <span className="text-xs font-normal text-muted-foreground">
                        {format(new Date(version.createdAt), "PPp")}
                      </span>
                    </div>
                    <div className="truncate text-sm font-normal text-muted-foreground">
                      {version.name} ·{" "}
                      {formatDashboardVersionActor(version.createdBy)}
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {getDashboardVersionBadges(version).map((badge) => (
                        <Badge
                          key={badge}
                          variant={badge === "Current" ? "default" : "outline"}
                        >
                          {badge}
                        </Badge>
                      ))}
                    </div>
                  </div>
                </Button>
              );
            })}

            {versionsQuery.hasNextPage && (
              <Button
                type="button"
                variant="outline"
                className="w-full"
                loading={versionsQuery.isFetchingNextPage}
                disabled={versionsQuery.isFetchingNextPage}
                onClick={() => void versionsQuery.fetchNextPage()}
              >
                Load older versions
              </Button>
            )}
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}

interface DashboardVersionHistoryProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
  viewId: string;
  selectedVersion: number | null;
  onSelectVersion: (version: number) => void;
}
