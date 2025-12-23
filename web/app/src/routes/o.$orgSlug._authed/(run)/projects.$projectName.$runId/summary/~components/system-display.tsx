import { z } from "zod";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Cpu, MemoryStickIcon as Memory } from "lucide-react";
import { Progress } from "@/components/ui/progress";

interface SystemDisplayProps {
  systemMetadata: any;
}

const systemMetadataSchema = z.object({
  cpu: z.object({
    freq: z
      .object({
        min: z.number().optional().nullable(),
        max: z.number().optional().nullable(),
      })
      .optional()
      .nullable(),
    virtual: z.number().optional().nullable(),
    physical: z.number().optional().nullable(),
  }),
  memory: z.object({
    swap: z.number().optional().nullable(),
    virt: z.number().optional().nullable(),
  }),
});

export function SystemDisplay({ systemMetadata }: SystemDisplayProps) {
  const parseResult = systemMetadataSchema.safeParse(systemMetadata);

  if (!parseResult.success) {
    return null;
  }

  const { data } = parseResult;

  // Format bytes to human-readable format
  const formatBytes = (bytes: number | null | undefined) => {
    if (bytes == null) return "N/A";

    const units = ["B", "KB", "MB", "GB", "TB"];
    let value = bytes;
    let unitIndex = 0;

    while (value >= 1024 && unitIndex < units.length - 1) {
      value /= 1024;
      unitIndex++;
    }

    return `${value.toFixed(2)} ${units[unitIndex]}`;
  };

  // Format frequency to GHz
  const formatFreq = (freq: number | null | undefined) => {
    if (freq == null || freq === 0) return "N/A";
    return `${(freq / 1000).toFixed(2)} GHz`;
  };

  // Calculate CPU usage percentage (mock for visualization)
  const cpuUsagePercent =
    data.cpu.freq?.max &&
    data.cpu.freq?.min &&
    data.cpu.freq.max > 0 &&
    data.cpu.freq.min > 0
      ? Math.round(
          ((data.cpu.freq.max - data.cpu.freq.min) / data.cpu.freq.max) * 100,
        )
      : 75; // Fallback value for visualization

  // Calculate memory usage percentage (mock for visualization)
  const memoryUsagePercent =
    data.memory.virt && data.memory.swap
      ? Math.round((data.memory.swap / data.memory.virt) * 100)
      : 60; // Fallback value for visualization

  return (
    <div className="grid gap-6 md:grid-cols-2">
      <Card className="overflow-hidden">
        <CardHeader className="relative flex flex-row items-center justify-between space-y-0 pb-2">
          <div>
            <CardTitle className="text-lg font-semibold">
              CPU Information
            </CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              System Processor Details
            </p>
          </div>
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-cyan-100 dark:bg-cyan-900">
            <Cpu className="h-5 w-5 text-cyan-600 dark:text-cyan-300" />
          </div>
        </CardHeader>
        <CardContent className="relative">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-3">
              <div className="rounded-lg border border-muted p-3 shadow-sm backdrop-blur-sm">
                <div className="mb-1 text-xs text-muted-foreground">
                  Min Frequency
                </div>
                <div className="text-lg font-semibold">
                  {data.cpu.freq?.min && data.cpu.freq.min > 0
                    ? formatFreq(data.cpu.freq.min)
                    : "N/A"}
                </div>
              </div>
              <div className="rounded-lg border border-muted bg-background/80 p-3 shadow-sm backdrop-blur-sm">
                <div className="mb-1 text-xs text-muted-foreground">
                  Physical Cores
                </div>
                <div className="text-lg font-semibold">
                  {data.cpu.physical ?? "N/A"}
                </div>
              </div>
            </div>
            <div className="space-y-3">
              <div className="rounded-lg border border-muted bg-background/80 p-3 shadow-sm backdrop-blur-sm">
                <div className="mb-1 text-xs text-muted-foreground">
                  Max Frequency
                </div>
                <div className="text-lg font-semibold">
                  {data.cpu.freq?.max && data.cpu.freq.max > 0
                    ? formatFreq(data.cpu.freq.max)
                    : "N/A"}
                </div>
              </div>
              <div className="rounded-lg border border-muted bg-background/80 p-3 shadow-sm backdrop-blur-sm">
                <div className="mb-1 text-xs text-muted-foreground">
                  Virtual Cores
                </div>
                <div className="text-lg font-semibold">
                  {data.cpu.virtual ?? "N/A"}
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="overflow-hidden">
        <CardHeader className="relative flex flex-row items-center justify-between space-y-0 pb-2">
          <div>
            <CardTitle className="text-lg font-semibold">
              Memory Information
            </CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              System Memory Details
            </p>
          </div>
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-purple-100 dark:bg-purple-900">
            <Memory className="h-5 w-5 text-purple-600 dark:text-purple-300" />
          </div>
        </CardHeader>
        <CardContent className="relative">
          <div className="grid grid-cols-2 gap-4">
            <div className="rounded-lg border border-muted bg-background/80 p-3 shadow-sm backdrop-blur-sm">
              <div className="mb-1 text-xs text-muted-foreground">
                Virtual Memory
              </div>
              <div className="text-lg font-semibold">
                {formatBytes(data.memory.virt)}
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                Total Available
              </div>
            </div>
            <div className="rounded-lg border border-muted bg-background/80 p-3 shadow-sm backdrop-blur-sm">
              <div className="mb-1 text-xs text-muted-foreground">
                Swap Memory
              </div>
              <div className="text-lg font-semibold">
                {formatBytes(data.memory.swap)}
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                Allocated
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
