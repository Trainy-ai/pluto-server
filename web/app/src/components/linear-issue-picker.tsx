import { useQuery } from "@tanstack/react-query";
import { trpc } from "@/utils/trpc";
import { CommandGroup, CommandItem } from "@/components/ui/command";
import { Badge } from "@/components/ui/badge";
import { Loader2 } from "lucide-react";
import { useDebounceValue } from "@/lib/hooks/use-debounce-value";

interface LinearIssuePickerProps {
  organizationId: string;
  searchQuery: string;
  onSelectIssue: (identifier: string) => void;
  selectedTags: string[];
  /** Tag prefix used when checking if an issue is already added. Defaults to "linear". */
  tagPrefix?: "linear" | "baseline";
}

export function LinearIssuePicker({
  organizationId,
  searchQuery,
  onSelectIssue,
  selectedTags,
  tagPrefix = "linear",
}: LinearIssuePickerProps) {
  const debouncedQuery = useDebounceValue(searchQuery, 500);

  const { data: issues, isLoading } = useQuery(
    trpc.organization.integrations.searchLinearIssues.queryOptions(
      {
        organizationId,
        query: debouncedQuery,
        limit: 10,
      },
      {
        enabled: debouncedQuery.length > 0,
        refetchOnWindowFocus: false,
      },
    ),
  );

  if (!debouncedQuery) {
    return null;
  }

  if (isLoading) {
    return (
      <CommandGroup heading="Linear Issues">
        <div className="flex items-center justify-center py-2">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        </div>
      </CommandGroup>
    );
  }

  if (!issues?.length) {
    return null;
  }

  return (
    <CommandGroup heading={tagPrefix === "baseline" ? "Linear Issues (as baseline)" : "Linear Issues"}>
      {issues.map((issue) => {
        const tagValue = `${tagPrefix}:${issue.identifier}`;
        const isSelected = selectedTags.includes(tagValue);

        return (
          <CommandItem
            key={issue.id}
            value={`linear-issue-${issue.identifier}`}
            onSelect={() => {
              if (!isSelected) {
                onSelectIssue(issue.identifier);
              }
            }}
            disabled={isSelected}
            className="flex items-center gap-2"
          >
            <span
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ backgroundColor: issue.stateColor }}
            />
            <Badge
              variant="outline"
              className={tagPrefix === "baseline"
                ? "shrink-0 border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-300"
                : "shrink-0 border-purple-300 bg-purple-50 text-purple-700 dark:border-purple-700 dark:bg-purple-950 dark:text-purple-300"
              }
            >
              {issue.identifier}
            </Badge>
            <span className="truncate text-sm">{issue.title}</span>
            {isSelected && (
              <span className="ml-auto text-xs text-muted-foreground">Added</span>
            )}
          </CommandItem>
        );
      })}
    </CommandGroup>
  );
}
