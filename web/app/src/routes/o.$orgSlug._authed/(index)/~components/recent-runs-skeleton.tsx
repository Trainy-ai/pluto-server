import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export function RecentRunsSkeleton() {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">
            Recent Runs
          </h1>
          <Skeleton className="mt-1 h-4 w-64" />
        </div>
        <Skeleton className="h-9 w-9" />
      </div>
      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-10" />
              <TableHead>Run</TableHead>
              <TableHead className="w-[110px]">Status</TableHead>
              <TableHead className="w-[100px]">Duration</TableHead>
              <TableHead className="w-[140px]">Created</TableHead>
              <TableHead className="w-[200px]">Tags</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {Array.from({ length: 10 }).map((_, i) => (
              <TableRow key={i}>
                <TableCell className="w-10 pr-0">
                  <Skeleton className="h-2.5 w-2.5 rounded-full" />
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-1">
                    <Skeleton className="h-4 w-20" />
                    <Skeleton className="h-4 w-2" />
                    <Skeleton className="h-4 w-28" />
                  </div>
                </TableCell>
                <TableCell>
                  <Skeleton className="h-5 w-16" />
                </TableCell>
                <TableCell>
                  <Skeleton className="h-4 w-14" />
                </TableCell>
                <TableCell>
                  <Skeleton className="h-4 w-20" />
                </TableCell>
                <TableCell>
                  <Skeleton className="h-4 w-12" />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
