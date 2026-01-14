import React, { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { LogGroup } from "../../~hooks/use-filtered-logs";
import { useGetTextFiles } from "../../~queries/get-text-files";
import { useStepNavigation } from "../../~hooks/use-step-navigation";
import { StepNavigator } from "../shared/step-navigator";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Download,
  Copy,
  Check,
  FileText,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { CodeBlock as ReactCodeBlock } from "react-code-block";
import { themes } from "prism-react-renderer";
import { useTheme } from "@/lib/hooks/use-theme";
import {
  isPlaintextFile,
  getLanguageForExtension,
  formatFileSize,
} from "@/lib/file-types";

interface TextViewProps {
  log: LogGroup["logs"][number];
  tenantId: string;
  projectName: string;
  runId: string;
}

interface TextFile {
  time: string;
  step: number;
  fileName: string;
  fileType: string;
  url: string;
}

const MAX_DISPLAY_SIZE = 500 * 1024; // 500KB
const MAX_DISPLAY_LINES = 5000;

interface TextContentProps {
  content: string;
  language: string;
  isLarge?: boolean;
  onDownload?: () => void;
}

function TextContent({
  content,
  language,
  isLarge,
  onDownload,
}: TextContentProps) {
  const { resolvedTheme } = useTheme();
  const [copied, setCopied] = useState(false);

  const isTruncatedByLines = isLarge && content.split("\n").length > MAX_DISPLAY_LINES;

  const displayContent = useMemo(() => {
    if (!isLarge) return content;
    const lines = content.split("\n");
    if (lines.length > MAX_DISPLAY_LINES) {
      return lines.slice(0, MAX_DISPLAY_LINES).join("\n");
    }
    return content.slice(0, MAX_DISPLAY_SIZE);
  }, [content, isLarge]);

  const handleCopy = () => {
    navigator.clipboard.writeText(displayContent);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="relative flex-1 overflow-hidden">
      {isLarge && (
        <div className="flex items-center justify-between border-b bg-yellow-500/10 px-4 py-2 text-sm text-yellow-600 dark:text-yellow-400">
          <span>
            Large file truncated.{" "}
            {isTruncatedByLines
              ? `Showing first ${MAX_DISPLAY_LINES} lines.`
              : `Preview limited to ${formatFileSize(MAX_DISPLAY_SIZE)}.`}
          </span>
          {onDownload && (
            <Button variant="link" size="sm" onClick={onDownload}>
              Download full file
            </Button>
          )}
        </div>
      )}
      <div className="absolute right-2 top-2 z-10 flex gap-1">
        <Button
          variant="secondary"
          size="icon"
          className="h-7 w-7 opacity-70 hover:opacity-100"
          onClick={handleCopy}
        >
          {copied ? (
            <Check className="h-3.5 w-3.5" />
          ) : (
            <Copy className="h-3.5 w-3.5" />
          )}
        </Button>
      </div>
      <div className="max-h-[400px] overflow-auto">
        <ReactCodeBlock
          code={displayContent}
          language={language}
          theme={resolvedTheme === "dark" ? themes.vsDark : themes.vsLight}
        >
          <ReactCodeBlock.Code className="!bg-transparent !p-4 text-sm">
            <div className="table-row">
              <ReactCodeBlock.LineNumber className="table-cell select-none pr-4 text-right font-mono text-xs text-muted-foreground" />
              <ReactCodeBlock.LineContent className="table-cell">
                <ReactCodeBlock.Token />
              </ReactCodeBlock.LineContent>
            </div>
          </ReactCodeBlock.Code>
        </ReactCodeBlock>
      </div>
    </div>
  );
}

interface TextViewHeaderProps {
  fileName: string;
  fileType: string;
  contentLength?: number;
  onDownload: () => void;
}

function TextViewHeader({
  fileName,
  fileType,
  contentLength,
  onDownload,
}: TextViewHeaderProps) {
  return (
    <div className="flex items-center justify-between border-b bg-muted/30 px-4 py-2">
      <div className="flex items-center gap-2 overflow-hidden">
        <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="truncate font-mono text-sm">{fileName}</span>
        {contentLength !== undefined && (
          <span className="shrink-0 text-xs text-muted-foreground">
            {formatFileSize(contentLength)}
          </span>
        )}
      </div>
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7"
        onClick={onDownload}
        title="Download"
      >
        <Download className="h-4 w-4" />
      </Button>
    </div>
  );
}

interface BinaryFileViewProps {
  fileName: string;
  fileType: string;
  onDownload: () => void;
}

function BinaryFileView({ fileName, fileType, onDownload }: BinaryFileViewProps) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-muted-foreground">
      <FileText className="h-16 w-16" />
      <div className="text-center">
        <p className="font-mono text-lg">{fileName}</p>
        <p className="text-sm">.{fileType} file - Preview not available</p>
      </div>
      <Button onClick={onDownload}>
        <Download className="mr-2 h-4 w-4" />
        Download File
      </Button>
    </div>
  );
}

interface FileSelectorProps {
  files: TextFile[];
  selectedIndex: number;
  onSelect: (index: number) => void;
}

function FileSelector({ files, selectedIndex, onSelect }: FileSelectorProps) {
  if (files.length <= 1) return null;

  return (
    <div className="flex items-center justify-center gap-2 border-t pt-3">
      <Button
        variant="outline"
        size="icon"
        className="h-8 w-8"
        onClick={() => onSelect(Math.max(0, selectedIndex - 1))}
        disabled={selectedIndex === 0}
      >
        <ChevronLeft className="h-4 w-4" />
      </Button>
      <span className="font-mono text-sm">
        File {selectedIndex + 1} / {files.length}
      </span>
      <Button
        variant="outline"
        size="icon"
        className="h-8 w-8"
        onClick={() => onSelect(Math.min(files.length - 1, selectedIndex + 1))}
        disabled={selectedIndex === files.length - 1}
      >
        <ChevronRight className="h-4 w-4" />
      </Button>
    </div>
  );
}

export function TextView({
  log,
  tenantId,
  projectName,
  runId,
}: TextViewProps) {
  const { data: files, isLoading: filesLoading } = useGetTextFiles(
    tenantId,
    projectName,
    runId,
    log.logName
  );

  const [selectedFileIndex, setSelectedFileIndex] = useState(0);

  // Step navigation
  const {
    currentStepIndex,
    currentStepValue,
    availableSteps,
    goToStepIndex,
  } = useStepNavigation((files as TextFile[]) || []);

  // Filter files for current step
  const currentStepFiles = useMemo(() => {
    if (!files) return [];
    return (files as TextFile[]).filter((f) => f.step === currentStepValue);
  }, [files, currentStepValue]);

  // Reset file index when step changes
  const handleStepChange = (index: number) => {
    goToStepIndex(index);
    setSelectedFileIndex(0);
  };

  // Selected file
  const selectedFile = currentStepFiles[selectedFileIndex];

  // Fetch file content
  const {
    data: content,
    isLoading: contentLoading,
    error: contentError,
  } = useQuery({
    queryKey: ["file-content", selectedFile?.url],
    queryFn: async () => {
      if (!selectedFile?.url) return null;
      const response = await fetch(selectedFile.url);
      if (!response.ok) {
        throw new Error(`Failed to fetch file: ${response.statusText}`);
      }
      return response.text();
    },
    enabled: !!selectedFile?.url && isPlaintextFile(selectedFile?.fileType || ""),
    staleTime: 1000 * 60 * 5, // 5 minutes
  });

  // Download handler
  const handleDownload = async () => {
    if (!selectedFile?.url) return;
    try {
      const response = await fetch(selectedFile.url);
      if (!response.ok) throw new Error("Failed to fetch file");
      const blob = await response.blob();
      const blobUrl = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = blobUrl;
      link.download = selectedFile.fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(blobUrl);
    } catch (error) {
      console.error("Download failed:", error);
      window.open(selectedFile.url, "_blank");
    }
  };

  // Loading state
  if (filesLoading || !files) {
    return (
      <div className="flex h-full flex-col space-y-4 p-4">
        <h3 className="text-center font-mono text-lg font-medium text-muted-foreground">
          {log.logName}
        </h3>
        <div className="flex-1 rounded-lg border">
          <div className="flex items-center justify-between border-b bg-muted/30 px-4 py-2">
            <Skeleton className="h-4 w-48" />
            <Skeleton className="h-7 w-16" />
          </div>
          <div className="p-4">
            <Skeleton className="mb-2 h-4 w-full" />
            <Skeleton className="mb-2 h-4 w-3/4" />
            <Skeleton className="mb-2 h-4 w-5/6" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        </div>
      </div>
    );
  }

  // Empty state
  if (!files || (files as TextFile[]).length === 0) {
    return (
      <div className="flex h-full flex-col space-y-4 p-4">
        <h3 className="text-center font-mono text-lg font-medium text-muted-foreground">
          {log.logName}
        </h3>
        <div className="flex flex-1 items-center justify-center text-muted-foreground">
          No files found
        </div>
      </div>
    );
  }

  const isPlaintext = selectedFile && isPlaintextFile(selectedFile.fileType);
  const isLargeFile = Boolean(content && content.length > MAX_DISPLAY_SIZE);
  const language = selectedFile
    ? getLanguageForExtension(selectedFile.fileType)
    : "text";

  return (
    <div className="flex h-full flex-col space-y-4 p-4">
      <h3 className="text-center font-mono text-lg font-medium">
        {log.logName}
      </h3>

      {/* Step Navigator */}
      {availableSteps.length > 1 && (
        <StepNavigator
          currentStepIndex={currentStepIndex}
          currentStepValue={currentStepValue}
          availableSteps={availableSteps}
          onStepChange={handleStepChange}
        />
      )}

      {/* File Viewer */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border bg-card">
        {selectedFile && (
          <>
            <TextViewHeader
              fileName={selectedFile.fileName}
              fileType={selectedFile.fileType}
              contentLength={content?.length}
              onDownload={handleDownload}
            />

            {isPlaintext ? (
              contentLoading ? (
                <div className="flex-1 p-4">
                  <Skeleton className="mb-2 h-4 w-full" />
                  <Skeleton className="mb-2 h-4 w-3/4" />
                  <Skeleton className="mb-2 h-4 w-5/6" />
                  <Skeleton className="h-4 w-2/3" />
                </div>
              ) : contentError ? (
                <div className="flex flex-1 items-center justify-center text-destructive">
                  Failed to load file content
                </div>
              ) : content ? (
                <TextContent
                  content={content}
                  language={language}
                  isLarge={isLargeFile}
                  onDownload={handleDownload}
                />
              ) : (
                <div className="flex flex-1 items-center justify-center text-muted-foreground">
                  No content
                </div>
              )
            ) : (
              <BinaryFileView
                fileName={selectedFile.fileName}
                fileType={selectedFile.fileType}
                onDownload={handleDownload}
              />
            )}
          </>
        )}
      </div>

      {/* File Selector (if multiple files at same step) */}
      <FileSelector
        files={currentStepFiles}
        selectedIndex={selectedFileIndex}
        onSelect={setSelectedFileIndex}
      />
    </div>
  );
}
