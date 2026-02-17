"use client";

import { CameraIcon, ClipboardCopyIcon, DownloadIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { copyChartToClipboard, downloadChartAsPng } from "./chart-export-utils";

interface ChartExportMenuProps {
  /** Returns the container element that holds the chart canvas */
  getContainer: () => HTMLElement | null;
  /** Base file name for downloads (without extension) */
  fileName: string;
  className?: string;
  /** "toolbar" = icon-only ghost button; "header" = outlined button with text */
  variant?: "toolbar" | "header";
}

export function ChartExportMenu({
  getContainer,
  fileName,
  className,
  variant = "toolbar",
}: ChartExportMenuProps) {
  const sanitizedName = fileName.replace(/[/\\?%*:|"<>]/g, "-");

  async function handleCopy() {
    const container = getContainer();
    if (!container) return;
    try {
      await copyChartToClipboard(container);
      toast.success("Chart copied to clipboard");
    } catch {
      toast.error("Failed to copy chart");
    }
  }

  async function handleDownload() {
    const container = getContainer();
    if (!container) return;
    try {
      await downloadChartAsPng(container, sanitizedName);
    } catch {
      toast.error("Failed to download chart");
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {variant === "header" ? (
          <Button
            variant="outline"
            size="sm"
            className={className}
            data-testid="chart-export-btn"
          >
            <CameraIcon className="mr-2 size-3.5" />
            Export
          </Button>
        ) : (
          <Button
            variant="ghost"
            size="icon"
            className={className}
            data-testid="chart-export-btn"
          >
            <CameraIcon className="size-3.5" />
          </Button>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={handleCopy}>
          <ClipboardCopyIcon className="mr-2 size-4" />
          Copy to clipboard
        </DropdownMenuItem>
        <DropdownMenuItem onClick={handleDownload}>
          <DownloadIcon className="mr-2 size-4" />
          Download PNG
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
