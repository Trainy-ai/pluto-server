import PageLayout from "@/components/layout/page-layout";
import { OrganizationPageTitle } from "@/components/layout/page-title";
import RunComparisonLayout from "@/components/layout/runComparison/layout";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute(
  "/o/$orgSlug/_authed/(runComparison)/projects/$projectName/table",
)({
  component: RouteComponent,
});

function RouteComponent() {
  const { projectName } = Route.useParams();

  return (
    <RunComparisonLayout>
      <PageLayout
        showSidebarTrigger={false}
        headerLeft={
          <OrganizationPageTitle
            breadcrumbs={[
              { title: "Home", to: "/o/$orgSlug" },
              { title: "Projects", to: "/o/$orgSlug/projects" },
            ]}
            title={projectName}
          />
        }
      >
        <div className="mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-[1200px] flex-col gap-6 p-6 sm:gap-8 sm:p-8">
          <div className="flex h-full w-full items-center justify-center">
            <h1 className="text-4xl font-bold text-muted-foreground">
              Table View of Runs (Work in Progress)
            </h1>
          </div>
        </div>
      </PageLayout>
    </RunComparisonLayout>
  );
}
