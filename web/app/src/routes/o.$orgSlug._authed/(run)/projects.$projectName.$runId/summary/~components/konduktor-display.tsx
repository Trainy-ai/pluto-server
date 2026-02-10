"use client";

import { useState, useEffect, useRef } from "react";
import { z } from "zod";
import { Card, CardContent } from "@/components/ui/card";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";
import {
  Server,
  Cpu,
  Copy,
  Check,
  Hash,
  Clock,
  Container,
  RotateCcw,
} from "lucide-react";
import { cn } from "@/lib/utils";

const KonduktorSchema = z.object({
  konduktor: z.object({
    job_name: z.string(),
    num_nodes: z.string().nullable().optional(),
    num_gpus_per_node: z.string().nullable().optional(),
    total_gpus: z.number().nullable().optional(),
    rank: z.string().nullable().optional(),
    master_addr: z.string().nullable().optional(),
    accelerator_type: z.string().nullable().optional(),
    node_name: z.string().nullable().optional(),
    restart_attempt: z.string().nullable().optional(),
    namespace: z.string().nullable().optional(),
  }),
});

type RunStatus =
  | "RUNNING"
  | "COMPLETED"
  | "TERMINATED"
  | "FAILED"
  | "CANCELLED";

interface KonduktorDisplayProps {
  systemMetadata: unknown;
  run: {
    createdAt: Date;
    updatedAt: Date;
    status: RunStatus;
  };
}

export function KonduktorDisplay({
  systemMetadata,
  run,
}: KonduktorDisplayProps) {
  const parseResult = KonduktorSchema.safeParse(systemMetadata);

  if (!parseResult.success) {
    return null;
  }

  const k = parseResult.data.konduktor;
  const numGpusPerNode = parseInt(k.num_gpus_per_node ?? "0", 10) || 0;
  const numNodes = parseInt(k.num_nodes ?? "0", 10) || 0;
  const totalGpus = k.total_gpus ?? numGpusPerNode * numNodes;

  const acceleratorLabel =
    numGpusPerNode && k.accelerator_type
      ? `${numGpusPerNode}x ${k.accelerator_type}`
      : k.accelerator_type ?? null;

  const totalGpuLabel =
    totalGpus > 0 && numNodes > 0
      ? `${totalGpus} GPUs (${numNodes} ${numNodes === 1 ? "node" : "nodes"})`
      : null;

  const rankLabel =
    k.rank != null && numNodes > 0
      ? `Rank ${k.rank} of ${numNodes}`
      : k.rank != null
        ? `Rank ${k.rank}`
        : null;

  const restartAttempt = parseInt(k.restart_attempt ?? "0", 10) || 0;

  return (
    <Card
      className={cn(
        "relative overflow-hidden border-l-4 border-l-orange-500 shadow-md dark:shadow-none",
      )}
    >
      <CardContent className="p-6">
        {/* Header */}
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Server className="h-5 w-5 text-orange-500" />
            <h3 className="text-lg font-bold tracking-tight">Konduktor Job</h3>
          </div>
          {restartAttempt > 0 && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger>
                  <Badge variant="secondary" className="gap-1">
                    <RotateCcw className="h-3 w-3" />
                    Restart #{restartAttempt}
                  </Badge>
                </TooltipTrigger>
                <TooltipContent>
                  <p>This pod has been restarted {restartAttempt} time(s)</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </div>

        {/* Job & Infrastructure */}
        <div className="space-y-3">
          <InfoRow label="Job Name" icon={<Hash className="h-4 w-4 text-orange-500" />}>
            <CopyableText text={k.job_name} />
          </InfoRow>

          {acceleratorLabel && (
            <InfoRow label="Accelerator" icon={<Cpu className="h-4 w-4 text-orange-500" />}>
              <span className="font-mono text-sm">{acceleratorLabel}</span>
            </InfoRow>
          )}

          {totalGpuLabel && (
            <InfoRow label="Total" icon={<Cpu className="h-4 w-4 text-orange-500" />}>
              <span className="font-mono text-sm">{totalGpuLabel}</span>
            </InfoRow>
          )}

          {rankLabel && (
            <InfoRow label="Rank" icon={<Hash className="h-4 w-4 text-muted-foreground" />}>
              <span className="font-mono text-sm">{rankLabel}</span>
            </InfoRow>
          )}
        </div>

        {/* Divider */}
        {(k.node_name || k.namespace || totalGpus > 0) && (
          <div className="my-4 border-t" />
        )}

        {/* Placement & Cost */}
        <div className="space-y-3">
          {k.node_name && (
            <InfoRow label="Node" icon={<Server className="h-4 w-4 text-muted-foreground" />}>
              <CopyableText text={k.node_name} />
            </InfoRow>
          )}

          {k.namespace && (
            <InfoRow
              label="Namespace"
              icon={<Container className="h-4 w-4 text-muted-foreground" />}
            >
              <span className="font-mono text-sm">{k.namespace}</span>
            </InfoRow>
          )}

          {totalGpus > 0 && (
            <GpuHours
              totalGpus={totalGpus}
              createdAt={run.createdAt}
              updatedAt={run.updatedAt}
              status={run.status}
            />
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function InfoRow({
  label,
  icon,
  children,
}: {
  label: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between rounded-lg bg-muted/50 px-3 py-2">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        {icon}
        <span>{label}</span>
      </div>
      <div>{children}</div>
    </div>
  );
}

function CopyableText({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const timeoutRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    return () => {
      if (timeoutRef.current !== undefined) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  const handleCopy = () => {
    clearTimeout(timeoutRef.current);
    navigator.clipboard.writeText(text);
    setCopied(true);
    timeoutRef.current = window.setTimeout(() => setCopied(false), 2000);
  };

  return (
    <button
      onClick={handleCopy}
      className="flex items-center gap-1.5 rounded px-1.5 py-0.5 font-mono text-sm transition-colors hover:bg-muted"
    >
      <span className="max-w-[200px] truncate">{text}</span>
      {copied ? (
        <Check className="h-3 w-3 text-green-500" />
      ) : (
        <Copy className="h-3 w-3 text-muted-foreground" />
      )}
    </button>
  );
}

function GpuHours({
  totalGpus,
  createdAt,
  updatedAt,
  status,
}: {
  totalGpus: number;
  createdAt: Date;
  updatedAt: Date;
  status: RunStatus;
}) {
  const isCompleted =
    status === "COMPLETED" ||
    status === "TERMINATED" ||
    status === "FAILED" ||
    status === "CANCELLED";

  const [gpuHours, setGpuHours] = useState<number>(0);

  useEffect(() => {
    const compute = () => {
      const start = new Date(createdAt).getTime();
      const end = isCompleted ? new Date(updatedAt).getTime() : Date.now();
      const hours = (end - start) / (1000 * 60 * 60);
      setGpuHours(totalGpus * hours);
    };

    compute();

    if (!isCompleted) {
      const interval = setInterval(compute, 1000);
      return () => clearInterval(interval);
    }
  }, [totalGpus, createdAt, updatedAt, isCompleted]);

  const formatted =
    gpuHours < 1
      ? `${(gpuHours * 60).toFixed(1)} GPU-min`
      : `${gpuHours.toFixed(1)} GPU-hrs`;

  return (
    <InfoRow label="GPU-Hours" icon={<Clock className="h-4 w-4 text-muted-foreground" />}>
      <span className="font-mono text-sm font-medium">{formatted}</span>
    </InfoRow>
  );
}
