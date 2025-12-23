import { trpc } from "@/utils/trpc";
import { useQuery } from "@tanstack/react-query";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  Database,
  HardDrive,
  Table,
  FileText,
  BarChart,
  Info,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { useState } from "react";
import {
  DocsTooltip,
  Tooltip,
  UnstyledTooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface UsageProps {
  organizationId: string;
  maxUsage?: number;
}

export function Usage({ organizationId, maxUsage = 100 }: UsageProps) {
  const [showStorageBreakdown, setShowStorageBreakdown] = useState(false);
  const [showTableBreakdown, setShowTableBreakdown] = useState(false);

  const { data: usage, isLoading } = useQuery(
    trpc.organization.usage.dataUsage.queryOptions({
      organizationId,
    }),
  );

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Database className="h-5 w-5 text-muted-foreground/70" />
              <div className="h-6 w-40 animate-pulse rounded-md bg-muted"></div>
            </div>
            <div className="mt-1.5 h-4 w-56 animate-pulse rounded-md bg-muted"></div>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {/* Skeleton for main progress bar */}
              <div className="h-2 w-full animate-pulse rounded-full bg-muted"></div>

              {/* Skeleton for storage breakdown button */}
              <div className="flex w-full items-center justify-between rounded-md border p-2">
                <div className="flex items-center gap-2">
                  <div className="h-4 w-32 animate-pulse rounded-md bg-muted"></div>
                  <div className="h-3.5 w-3.5 animate-pulse rounded-full bg-muted"></div>
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground/70" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!usage) {
    return (
      <div className="space-y-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg">Storage Usage</CardTitle>
            <CardDescription>No usage data available</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  // Format table details for display
  const tableDetails = Object.entries(usage.breakdown.tableDetails)
    .map(([name, value]) => ({
      name,
      value: parseFloat(value.toFixed(3)),
      percentage:
        usage.breakdown.tableStorageGb > 0
          ? (value / usage.breakdown.tableStorageGb) * 100
          : 0,
    }))
    .sort((a, b) => b.value - a.value);

  // Calculate the percentage of total usage compared to max
  const usagePercentage =
    maxUsage > 0 ? (usage.totalStorageGb / maxUsage) * 100 : 0;

  // Calculate file and table storage percentages safely
  const fileStoragePercentage =
    usage.totalStorageGb > 0
      ? (usage.breakdown.fileStorageGb / usage.totalStorageGb) * 100
      : 0;

  const tableStoragePercentage =
    usage.totalStorageGb > 0
      ? (usage.breakdown.tableStorageGb / usage.totalStorageGb) * 100
      : 0;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Database className="h-5 w-5" />
            Storage Usage
            <Tooltip>
              <TooltipTrigger asChild>
                <Info className="ml-1 h-4 w-4 cursor-help text-muted-foreground" />
              </TooltipTrigger>
              <UnstyledTooltipContent>
                <DocsTooltip
                  title="Total Storage Usage"
                  iconComponent={<Database className="h-4 w-4" />}
                  description={`Your total storage usage across all data types. Your current limit is ${maxUsage} GB.`}
                />
              </UnstyledTooltipContent>
            </Tooltip>
          </CardTitle>
          <CardDescription>
            Using {usage.totalStorageGb.toFixed(3)} GB of {maxUsage} GB
            {usagePercentage > 0 && ` (${Math.round(usagePercentage)}%)`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <Progress value={usagePercentage} className="h-2" />

            <button
              onClick={() => setShowStorageBreakdown(!showStorageBreakdown)}
              className="flex w-full items-center justify-between rounded-md border p-2 text-sm font-medium transition-colors hover:bg-muted/50"
            >
              <div className="flex items-center gap-2">
                <span>Storage Breakdown</span>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Info className="h-3.5 w-3.5 cursor-help text-muted-foreground" />
                  </TooltipTrigger>
                  <UnstyledTooltipContent>
                    <DocsTooltip
                      title="Storage Distribution"
                      description="Breakdown of storage usage between files and database tables."
                    />
                  </UnstyledTooltipContent>
                </Tooltip>
              </div>
              {showStorageBreakdown ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
            </button>

            {showStorageBreakdown && (
              <div className="ml-4 space-y-4 border-l pl-4">
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <HardDrive className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm font-medium">File Storage</span>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Info className="h-3.5 w-3.5 cursor-help text-muted-foreground" />
                        </TooltipTrigger>
                        <UnstyledTooltipContent>
                          <DocsTooltip
                            title="File Storage"
                            iconComponent={<HardDrive className="h-4 w-4" />}
                            description="Storage used by uploaded files and documents."
                          />
                        </UnstyledTooltipContent>
                      </Tooltip>
                    </div>
                    <span className="text-sm font-medium">
                      {usage.breakdown.fileStorageGb.toFixed(3)} GB
                      {fileStoragePercentage > 0 &&
                        ` (${Math.round(fileStoragePercentage)}%)`}
                    </span>
                  </div>
                  <Progress value={fileStoragePercentage} className="h-2" />
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Table className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm font-medium">Table Storage</span>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Info className="h-3.5 w-3.5 cursor-help text-muted-foreground" />
                        </TooltipTrigger>
                        <UnstyledTooltipContent>
                          <DocsTooltip
                            title="Table Storage"
                            iconComponent={<Table className="h-4 w-4" />}
                            description="Storage used by database tables for metrics, logs, and other structured data."
                          />
                        </UnstyledTooltipContent>
                      </Tooltip>
                    </div>
                    <span className="text-sm font-medium">
                      {usage.breakdown.tableStorageGb.toFixed(3)} GB
                      {tableStoragePercentage > 0 &&
                        ` (${Math.round(tableStoragePercentage)}%)`}
                    </span>
                  </div>
                  <Progress value={tableStoragePercentage} className="h-2" />
                </div>

                <button
                  onClick={() => setShowTableBreakdown(!showTableBreakdown)}
                  className="flex w-full items-center justify-between rounded-md border p-2 text-sm font-medium transition-colors hover:bg-muted/50"
                >
                  <div className="flex items-center gap-2">
                    <span>Table Storage Breakdown</span>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Info className="h-3.5 w-3.5 cursor-help text-muted-foreground" />
                      </TooltipTrigger>
                      <UnstyledTooltipContent>
                        <DocsTooltip
                          title="Table Storage Details"
                          iconComponent={<BarChart className="h-4 w-4" />}
                          description="Detailed breakdown of storage usage by individual data tables."
                        />
                      </UnstyledTooltipContent>
                    </Tooltip>
                  </div>
                  {showTableBreakdown ? (
                    <ChevronDown className="h-4 w-4" />
                  ) : (
                    <ChevronRight className="h-4 w-4" />
                  )}
                </button>

                {showTableBreakdown && (
                  <div className="ml-4 space-y-3 border-l pl-4">
                    {tableDetails.map((item) => (
                      <div key={item.name} className="space-y-2">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <FileText className="h-4 w-4 text-muted-foreground" />
                            <span className="text-sm font-medium">
                              {item.name}
                            </span>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Info className="h-3.5 w-3.5 cursor-help text-muted-foreground" />
                              </TooltipTrigger>
                              <UnstyledTooltipContent>
                                <DocsTooltip
                                  title={`${item.name} Table`}
                                  iconComponent={
                                    <FileText className="h-4 w-4" />
                                  }
                                  description={`Storage used by the ${item.name} data table.`}
                                />
                              </UnstyledTooltipContent>
                            </Tooltip>
                          </div>
                          <span className="text-sm font-medium">
                            {item.value.toFixed(3)} GB
                            {item.percentage > 0 &&
                              ` (${Math.round(item.percentage)}%)`}
                          </span>
                        </div>
                        <Progress value={item.percentage} className="h-2" />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
