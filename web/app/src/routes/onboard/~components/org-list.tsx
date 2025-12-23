import * as React from "react";
import { Link } from "@tanstack/react-router";
import { ChevronRightIcon, PlusIcon, StoreIcon, UserIcon } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { InputSearch } from "@/components/ui/input-search";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { Organization } from "@/lib/auth/org";

export type OrganizationListProps = {
  organizations: Organization[];
  redirect?: string;
};

export function OrganizationList({
  organizations,
  redirect,
}: OrganizationListProps): React.JSX.Element {
  const [searchQuery, setSearchQuery] = React.useState<string>("");
  const filteredOrganizations = organizations.filter(
    (o) =>
      !searchQuery ||
      o.name.toLowerCase().indexOf(searchQuery.toLowerCase()) !== -1 ||
      o.slug.toLowerCase().indexOf(searchQuery.toLowerCase()) !== -1,
  );
  const handleSearchQueryChange = (
    e: React.ChangeEvent<HTMLInputElement>,
  ): void => {
    setSearchQuery(e.target?.value || "");
  };

  if (organizations.length === 0) {
    return (
      <Card className="border-none shadow-none">
        <CardHeader className="text-center">
          <CardTitle>Create your first organization</CardTitle>
        </CardHeader>
        <CardContent>
          <Link
            to="/onboard/org"
            search={redirect ? { redirect } : undefined}
            className={buttonVariants({
              variant: "default",
              className: "w-full whitespace-nowrap",
            })}
          >
            <PlusIcon className="mr-2 size-4 shrink-0" />
            <span className="hidden sm:inline">Create organization</span>
            <span className="inline sm:hidden">Create</span>
          </Link>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-none shadow-none">
      <CardContent className="space-y-6">
        <div className="flex items-center gap-4">
          <InputSearch
            placeholder="Search organizations..."
            value={searchQuery}
            onChange={handleSearchQueryChange}
            className="flex-1"
          />
          <Link
            to="/onboard/org"
            search={redirect ? { redirect } : undefined}
            className={buttonVariants({
              variant: "default",
              className: "whitespace-nowrap shadow-sm",
            })}
          >
            <PlusIcon className="mr-2 size-4 shrink-0" />
            <span className="hidden sm:inline">New organization</span>
            <span className="inline sm:hidden">New</span>
          </Link>
        </div>
        {filteredOrganizations.length === 0 ? (
          <EmptyState
            icon={<StoreIcon className="size-8" />}
            title="No organizations found"
            description={
              searchQuery
                ? "No organizations match your search. Try a different term."
                : "Create your first organization to get started."
            }
          />
        ) : (
          <ScrollArea className="[&>[data-radix-scroll-area-viewport]]:max-h-[calc(100svh-24rem)]">
            <div className="grid gap-3">
              {filteredOrganizations.map((organization) => (
                <Link
                  key={organization.id}
                  to={`/o/$orgSlug`}
                  params={{ orgSlug: organization.slug }}
                  search={redirect ? { redirect } : undefined}
                  preload="viewport"
                  className="group relative flex flex-col rounded-lg border bg-card transition-all hover:bg-accent/40 hover:shadow-md active:scale-[0.99] active:bg-accent/60"
                >
                  <div className="flex h-full flex-row items-center justify-between p-4">
                    <div className="flex flex-row items-center gap-3">
                      <Avatar className="aspect-square size-10 rounded-lg">
                        <AvatarImage
                          className="rounded-lg object-cover"
                          src={organization.logo || undefined}
                        />
                        <AvatarFallback className="rounded-lg text-base">
                          {organization.name.charAt(0)}
                        </AvatarFallback>
                      </Avatar>
                      <div>
                        <div className="leading-none font-medium">
                          {organization.name}
                        </div>
                        <div className="mt-1 text-sm text-muted-foreground">
                          /{organization.slug}
                        </div>
                      </div>
                    </div>
                    <ChevronRightIcon className="size-5 text-muted-foreground transition-colors group-hover:text-foreground" />
                  </div>
                </Link>
              ))}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}
