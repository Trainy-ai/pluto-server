"use client";

import type React from "react";
import { useState, useEffect } from "react";
import { z } from "zod";
import { Card, CardContent } from "@/components/ui/card";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";
import { Cpu, Thermometer, Database, Activity, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface GpuDisplayProps {
  systemMetadata: unknown;
  refreshInterval?: number; // Optional refresh interval in ms
}

// Enhanced Zod schema validation with AMD support
const GpuSchema = z.object({
  gpu: z.object({
    // Nvidia GPUs
    nvidia: z
      .object({
        count: z.number().int().nonnegative(),
        driver: z.string(),
        devices: z.array(
          z.object({
            pid: z.array(z.number().int().nonnegative()),
            name: z.string(),
            temp: z.number().int().nonnegative(), // in Celsius
            utilization: z.number().min(0).max(100).optional(), // GPU utilization %
            memory: z.object({
              total: z.number().int().positive(), // in bytes
              used: z.number().int().nonnegative().optional(), // in bytes
            }),
            clockSpeed: z.number().int().nonnegative().optional(), // in MHz
          }),
        ),
      })
      .optional(),

    // AMD GPUs
    amd: z
      .object({
        count: z.number().int().nonnegative(),
        driver: z.string(),
        devices: z.array(
          z.object({
            pid: z.array(z.number().int().nonnegative()),
            name: z.string(),
            temp: z.number().int().nonnegative(), // in Celsius
            utilization: z.number().min(0).max(100).optional(), // GPU utilization %
            memory: z.object({
              total: z.number().int().positive(), // in bytes
              used: z.number().int().nonnegative().optional(), // in bytes
            }),
            clockSpeed: z.number().int().nonnegative().optional(), // in MHz
          }),
        ),
      })
      .optional(),
  }),
});

type GpuData = z.infer<typeof GpuSchema>;

// Fix the type issue by extracting the device type
type NvidiaDevice = NonNullable<
  z.infer<typeof GpuSchema>["gpu"]["nvidia"]
>["devices"][0];
type AmdDevice = NonNullable<
  z.infer<typeof GpuSchema>["gpu"]["amd"]
>["devices"][0];
type GpuDevice = NvidiaDevice | AmdDevice;

export function GpuDisplay({
  systemMetadata,
  refreshInterval = 5000,
}: GpuDisplayProps) {
  const [data, setData] = useState(systemMetadata);
  const [refreshTimestamp, setRefreshTimestamp] = useState(Date.now());

  // Simulate data refresh for real-time monitoring
  useEffect(() => {
    const timer = setInterval(() => {
      // In a real implementation, this would fetch new data
      // For now, we just update the timestamp
      setRefreshTimestamp(Date.now());
    }, refreshInterval);

    return () => clearInterval(timer);
  }, [refreshInterval]);

  const parseResult = GpuSchema.safeParse(data);

  if (!parseResult.success) {
    return null;
  }

  const gpuData = parseResult.data.gpu;
  const hasNvidia = gpuData.nvidia && gpuData.nvidia.count > 0;
  const hasAmd = gpuData.amd && gpuData.amd.count > 0;

  if (!hasNvidia && !hasAmd) {
    return (
      <Card>
        <CardContent className="p-6">
          <div className="font-medium text-muted-foreground">
            No GPU devices detected.
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <TooltipProvider>
        <div className="grid grid-cols-1">
          {/* Render NVIDIA GPUs */}
          {hasNvidia &&
            gpuData.nvidia?.devices.map((device, idx) => (
              <GpuCard
                key={`nvidia-${idx}`}
                device={device}
                driverVersion={gpuData.nvidia?.driver || "Unknown"}
                vendor="nvidia"
              />
            ))}

          {/* Render AMD GPUs */}
          {hasAmd &&
            gpuData.amd?.devices.map((device, idx) => (
              <GpuCard
                key={`amd-${idx}`}
                device={device}
                driverVersion={gpuData.amd?.driver || "Unknown"}
                vendor="amd"
              />
            ))}
        </div>
      </TooltipProvider>
    </div>
  );
}

interface GpuCardProps {
  device: GpuDevice;
  driverVersion: string;
  vendor: "nvidia" | "amd";
}

function GpuCard({ device, driverVersion, vendor }: GpuCardProps) {
  const memoryGB = (device.memory.total / 1024 ** 3).toFixed(1);
  const memoryUsedGB = device.memory.used
    ? (device.memory.used / 1024 ** 3).toFixed(1)
    : null;
  const memoryUsagePercent = device.memory.used
    ? Math.round((device.memory.used / device.memory.total) * 100)
    : null;

  // Temperature color based on value
  const getTempColor = (temp: number) => {
    if (temp < 50) return "text-green-500";
    if (temp < 75) return "text-yellow-500";
    return "text-red-500";
  };

  // Utilization color
  const getUtilColor = (util: number) => {
    if (util < 30) return "text-green-500";
    if (util < 70) return "text-yellow-500";
    return "text-red-500";
  };

  // Vendor class for styling
  const vendorClass =
    vendor === "nvidia" ? "border-l-green-500" : "border-l-red-500";

  return (
    <Card
      className={cn(
        "relative overflow-hidden border-l-4 shadow-md dark:shadow-none",
        vendorClass,
      )}
    >
      <CardContent className="p-6">
        {/* Header */}
        <div className="mb-6 flex items-start justify-between">
          <div className="flex items-center gap-4">
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-lg font-bold tracking-tight">
                  {vendor === "nvidia" ? "NVIDIA" : "AMD"} {device.name}
                </h3>
                <Badge
                  variant={vendor === "nvidia" ? "default" : "destructive"}
                  className="uppercase"
                >
                  {vendor}
                </Badge>
              </div>
            </div>
          </div>

          {/* Memory Display */}
          <div className="flex flex-col items-end gap-1">
            <div className="flex items-center gap-2">
              <Database className="h-4 w-4 text-blue-500" />
              <span className="font-mono text-sm">
                {memoryUsedGB
                  ? `${memoryUsedGB} GiB / ${memoryGB} GiB`
                  : `${memoryGB} GiB`}
              </span>
            </div>
            {memoryUsagePercent && (
              <div className="h-1.5 w-24 overflow-hidden rounded-full bg-muted">
                <div
                  className={cn(
                    "h-full rounded-full",
                    getUtilColor(memoryUsagePercent).replace("text-", "bg-"),
                  )}
                  style={{ width: `${memoryUsagePercent}%` }}
                />
              </div>
            )}
          </div>
        </div>

        {/* Tabs */}
        <Tabs defaultValue="info" className="w-full">
          <TabsList className="w-full">
            <TabsTrigger value="info" className="flex-1">
              Information
            </TabsTrigger>
            <TabsTrigger value="performance" className="flex-1">
              Performance
            </TabsTrigger>
          </TabsList>

          <TabsContent value="info" className="mt-4 space-y-4">
            <div className="mb-4">
              {vendor === "nvidia" ? (
                <NvidiaGpuIllustration />
              ) : (
                <AmdGpuIllustration />
              )}
            </div>

            <div className="rounded-lg border bg-muted/50 p-4">
              <div className="mb-2 text-sm font-medium">Driver Information</div>
              <div className="text-sm text-muted-foreground">
                Version: {driverVersion}
              </div>
            </div>

            {device.clockSpeed && (
              <div className="rounded-lg border bg-muted/50 p-4">
                <div className="mb-2 text-sm font-medium">
                  Base Configuration
                </div>
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Clock className="h-4 w-4 text-purple-500" />
                  Base Clock: {device.clockSpeed} MHz
                </div>
              </div>
            )}
          </TabsContent>

          <TabsContent value="performance" className="mt-4 space-y-4">
            {/* VRAM */}
            <div className="rounded-lg border bg-muted/50 p-4">
              <div className="mb-2 text-sm font-medium">VRAM</div>
              <div className="flex items-center gap-2">
                <Database className="h-5 w-5 text-blue-500" />
                <span className="font-medium">
                  {device.memory.total / 1024 ** 3} GB
                </span>
              </div>
            </div>

            {/* GPU Utilization */}
            {device.utilization !== undefined && (
              <div className="rounded-lg border bg-muted/50 p-4">
                <div className="mb-2 text-sm font-medium">GPU Utilization</div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Activity
                      className={cn(
                        "h-5 w-5",
                        getUtilColor(device.utilization),
                      )}
                    />
                    <span className="text-sm text-muted-foreground">
                      {device.utilization}%
                    </span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className={cn(
                        "h-full rounded-full",
                        getUtilColor(device.utilization).replace(
                          "text-",
                          "bg-",
                        ),
                      )}
                      style={{ width: `${device.utilization}%` }}
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Process Information */}
            <div className="rounded-lg border bg-muted/50 p-4">
              <div className="mb-2 flex items-center gap-2 text-sm font-medium">
                <Cpu className="h-4 w-4 text-purple-500" />
                Active Processes ({device.pid.length})
              </div>
              {device.pid.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {device.pid.map((pid: number) => (
                    <Tooltip key={pid}>
                      <TooltipTrigger>
                        <Badge variant="secondary" className="font-mono">
                          {pid}
                        </Badge>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>Process ID: {pid}</p>
                      </TooltipContent>
                    </Tooltip>
                  ))}
                </div>
              )}
            </div>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}

function NvidiaGpuIllustration() {
  return (
    <div className="flex h-36 w-full items-center justify-center">
      <svg
        className="h-full w-full"
        viewBox="0 0 240 120"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        {/* GPU Base */}
        <rect
          x="20"
          y="20"
          width="200"
          height="80"
          rx="4"
          className="fill-gray-800 dark:fill-gray-700"
          stroke="currentColor"
          strokeOpacity="0.2"
          strokeWidth="2"
        />

        {/* PCIe Connector */}
        <rect
          x="20"
          y="100"
          width="200"
          height="10"
          className="fill-gray-600 dark:fill-gray-600"
        />
        <rect
          x="30"
          y="100"
          width="180"
          height="10"
          className="fill-gray-700 dark:fill-gray-700"
        />

        {/* Heatsink */}
        <rect
          x="30"
          y="30"
          width="180"
          height="60"
          rx="2"
          className="fill-gray-700 dark:fill-gray-800"
          stroke="currentColor"
          strokeOpacity="0.1"
          strokeWidth="1"
        />

        {/* Heatsink Fins */}
        {Array.from({ length: 7 }).map((_, i) => (
          <rect
            key={i}
            x={45 + i * 22}
            y="35"
            width="12"
            height="50"
            rx="1"
            className="fill-gray-600 dark:fill-gray-700"
          />
        ))}

        {/* Fan */}
        <circle
          cx="120"
          cy="60"
          r="25"
          className="fill-gray-800 dark:fill-gray-900"
          stroke="currentColor"
          strokeOpacity="0.1"
          strokeWidth="1"
        />

        {/* Fan Blades - with vanilla CSS animation */}
        <g
          style={{
            animation: "spin 1.5s linear infinite",
            transformOrigin: "120px 60px",
          }}
        >
          {Array.from({ length: 9 }).map((_, i) => {
            const angle = (i * 40 * Math.PI) / 180;
            const x1 = 120 + 5 * Math.cos(angle);
            const y1 = 60 + 5 * Math.sin(angle);
            const x2 = 120 + 22 * Math.cos(angle);
            const y2 = 60 + 22 * Math.sin(angle);
            return (
              <path
                key={i}
                d={`M${x1},${y1} L${x2},${y2} A2,2 0 0 1 ${x2 + 2},${y2 + 2} Z`}
                className="fill-gray-600 dark:fill-gray-700"
                strokeWidth="1"
                strokeLinecap="round"
              />
            );
          })}
        </g>

        {/* Fan Center */}
        <circle
          cx="120"
          cy="60"
          r="5"
          className="fill-gray-600 dark:fill-gray-600"
        />
        <circle
          cx="120"
          cy="60"
          r="2"
          className="fill-gray-500 dark:fill-gray-500"
        />

        {/* Display Ports */}
        <rect
          x="40"
          y="10"
          width="10"
          height="10"
          rx="1"
          className="fill-gray-500 dark:fill-gray-600"
        />
        <rect
          x="60"
          y="10"
          width="10"
          height="10"
          rx="1"
          className="fill-gray-500 dark:fill-gray-600"
        />
        <rect
          x="80"
          y="10"
          width="10"
          height="10"
          rx="1"
          className="fill-gray-500 dark:fill-gray-600"
        />

        {/* Power connectors */}
        <rect
          x="190"
          y="40"
          width="20"
          height="10"
          className="fill-gray-500 dark:fill-gray-600"
        />
        <rect
          x="190"
          y="60"
          width="20"
          height="10"
          className="fill-gray-500 dark:fill-gray-600"
        />
      </svg>
    </div>
  );
}

function AmdGpuIllustration() {
  return (
    <div className="flex h-36 w-full items-center justify-center">
      <svg
        className="h-full w-full"
        viewBox="0 0 240 120"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        {/* GPU Base */}
        <rect
          x="20"
          y="20"
          width="200"
          height="80"
          rx="4"
          className="fill-gray-800 dark:fill-gray-700"
          stroke="currentColor"
          strokeOpacity="0.2"
          strokeWidth="2"
        />

        {/* PCIe Connector */}
        <rect
          x="20"
          y="100"
          width="200"
          height="10"
          className="fill-gray-600 dark:fill-gray-600"
        />
        <rect
          x="30"
          y="100"
          width="180"
          height="10"
          className="fill-gray-700 dark:fill-gray-700"
        />

        {/* Heatsink */}
        <rect
          x="30"
          y="30"
          width="180"
          height="60"
          rx="2"
          className="fill-gray-700 dark:fill-gray-800"
          stroke="currentColor"
          strokeOpacity="0.1"
          strokeWidth="1"
        />

        {/* AMD Logo */}
        <text
          x="150"
          y="80"
          className="fill-red-500 font-bold"
          style={{ fontSize: "10px" }}
        >
          AMD RADEON
        </text>

        {/* Radeon accent line */}
        <path
          d="M30,30 L210,30 L210,35 L30,35 Z"
          className="fill-red-500 dark:fill-red-600"
        />

        {/* Heatsink Fins - Different style for AMD */}
        {Array.from({ length: 10 }).map((_, i) => (
          <rect
            key={i}
            x={40 + i * 16}
            y="40"
            width="8"
            height="40"
            rx="0"
            className="fill-gray-600 dark:fill-gray-700"
          />
        ))}

        {/* Two Fans */}
        <circle
          cx="80"
          cy="60"
          r="20"
          className="fill-gray-800 dark:fill-gray-900"
          stroke="currentColor"
          strokeOpacity="0.1"
          strokeWidth="1"
        />

        <circle
          cx="160"
          cy="60"
          r="20"
          className="fill-gray-800 dark:fill-gray-900"
          stroke="currentColor"
          strokeOpacity="0.1"
          strokeWidth="1"
        />

        {/* Fan 1 Blades - with CSS animation */}
        <g
          style={{
            animation: "spin 1.8s linear infinite",
            transformOrigin: "80px 60px",
          }}
        >
          {Array.from({ length: 7 }).map((_, i) => {
            const angle = (i * 51.4 * Math.PI) / 180;
            const x1 = 80 + 4 * Math.cos(angle);
            const y1 = 60 + 4 * Math.sin(angle);
            const x2 = 80 + 18 * Math.cos(angle);
            const y2 = 60 + 18 * Math.sin(angle);
            return (
              <path
                key={i}
                d={`M${x1},${y1} L${x2},${y2} A3,3 0 0 1 ${x2 + 3},${y2 + 3} Z`}
                className="fill-gray-600 dark:fill-gray-700"
                strokeWidth="1"
                strokeLinecap="round"
              />
            );
          })}
        </g>

        {/* Fan 2 Blades - with CSS animation, slightly different speed */}
        <g
          style={{
            animation: "spin 1.6s linear infinite",
            transformOrigin: "160px 60px",
          }}
        >
          {Array.from({ length: 7 }).map((_, i) => {
            const angle = (i * 51.4 * Math.PI) / 180;
            const x1 = 160 + 4 * Math.cos(angle);
            const y1 = 60 + 4 * Math.sin(angle);
            const x2 = 160 + 18 * Math.cos(angle);
            const y2 = 60 + 18 * Math.sin(angle);
            return (
              <path
                key={i}
                d={`M${x1},${y1} L${x2},${y2} A3,3 0 0 1 ${x2 + 3},${y2 + 3} Z`}
                className="fill-gray-600 dark:fill-gray-700"
                strokeWidth="1"
                strokeLinecap="round"
              />
            );
          })}
        </g>

        {/* Fan Centers */}
        <circle
          cx="80"
          cy="60"
          r="4"
          className="fill-gray-600 dark:fill-gray-600"
        />
        <circle
          cx="160"
          cy="60"
          r="4"
          className="fill-gray-600 dark:fill-gray-600"
        />
        <circle
          cx="80"
          cy="60"
          r="2"
          className="fill-gray-500 dark:fill-gray-500"
        />
        <circle
          cx="160"
          cy="60"
          r="2"
          className="fill-gray-500 dark:fill-gray-500"
        />

        {/* Display Ports */}
        <rect
          x="40"
          y="10"
          width="10"
          height="10"
          rx="1"
          className="fill-gray-500 dark:fill-gray-600"
        />
        <rect
          x="60"
          y="10"
          width="10"
          height="10"
          rx="1"
          className="fill-gray-500 dark:fill-gray-600"
        />
        <rect
          x="80"
          y="10"
          width="15"
          height="10"
          rx="1"
          className="fill-gray-500 dark:fill-gray-600"
        />

        {/* Power connectors */}
        <rect
          x="190"
          y="50"
          width="20"
          height="20"
          className="fill-gray-500 dark:fill-gray-600"
        />
      </svg>
    </div>
  );
}

// Add the following style to your global CSS or in the page where the component is used
// @keyframes spin {
//   from { transform: rotate(0deg); }
//   to { transform: rotate(360deg); }
// }
