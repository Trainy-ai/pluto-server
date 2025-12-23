import { CardHeader } from "@/components/ui/card";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export const RecentRunsSkeleton = () => {
  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
            Recent Runs
          </h1>
          <p className="mt-2 text-muted-foreground">
            Your most recent experiment runs
          </p>
        </div>
        <Skeleton className="h-10 w-10" />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {[...Array(4)].map((_, i) => (
          <Card key={i} className="relative overflow-hidden">
            <CardHeader className="space-y-4 p-4 sm:p-6">
              <div className="flex flex-col space-y-2">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex flex-wrap items-center gap-x-1">
                    <Skeleton className="h-7 w-20 bg-muted sm:w-32" />
                    <Skeleton className="h-7 w-4 bg-muted" />
                    <Skeleton className="h-7 w-24 sm:w-48" />
                  </div>
                  <Skeleton className="h-7 w-16 sm:w-20" />
                </div>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <Skeleton className="h-5 w-28 bg-muted sm:w-48" />
                  <Skeleton className="h-5 w-4 bg-muted" />
                  <Skeleton className="h-5 w-20 bg-muted sm:w-32" />
                </div>
              </div>
              <div className="flex items-center justify-end">
                <Skeleton className="h-5 w-20 bg-primary/20 sm:w-24" />
              </div>
            </CardHeader>
          </Card>
        ))}
      </div>
    </div>
  );
};
