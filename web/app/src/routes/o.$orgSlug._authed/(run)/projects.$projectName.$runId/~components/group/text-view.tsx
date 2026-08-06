import React, { useState, useMemo } from "react";
import {
  detectMediaJsonText,
  MAX_MEDIA_JSON_SIZE,
  type PlotlyFigure,
} from "@/lib/media-json";
import { PlotlyView } from "@/components/media/plotly-view";
import { SandboxedHtmlView } from "@/components/media/sandboxed-html-view";
import { PointCloudView } from "@/components/media/point-cloud-view";
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
import { useShikiHtml } from "@/lib/hooks/use-shiki";
import { TruncatedLabel } from "@/components/shared/truncated-label";
import {
  isPlaintextFile,
  isImageFile,
  isHtmlFile,
  getLanguageForExtension,
  formatFileSize,
} from "@/lib/file-types";

interface TextViewProps {
  log: LogGroup["logs"][number];
  tenantId: string;
  projectName: string;
  runId: string;
  /**
   * Suppress the internal logName heading when the embedder already renders
   * one (the all-runs file widget does), which otherwise shows the name twice.
   */
  hideTitle?: boolean;
  /**
   * Rendered instead of the syntax-highlighted source when the file turns out
   * to be ordinary text/JSON (i.e. not an image, HTML, Plotly figure or point
   * cloud).
   *
   * Only the content can say which a `.json` is — the filename is a UUID. The
   * all-runs widget wants figures and clouds rendered but not a raw blob dumped
   * into a small card, and it cannot know which it has without fetching. So it
   * passes its "View in Files" link down and this decides, off the single fetch
   * already happening here.
   */
  plainTextFallback?: React.ReactNode;
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

// The media-JSON sniff cap lives with the sniffer (MAX_MEDIA_JSON_SIZE in
// lib/media-json). This viewer used to carry its own 4MB copy against the Files
// tab's 8MB, so a 6MB figure charted there and dumped as text here.

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

  const highlightedHtml = useShikiHtml(displayContent, language);

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
      <div className="min-w-0 max-h-[400px] overflow-auto">
        {highlightedHtml ? (
          <div
            className="shiki-wrapper wrap-long-lines line-numbers p-4 text-sm"
            dangerouslySetInnerHTML={{ __html: highlightedHtml }}
          />
        ) : (
          <pre className="whitespace-pre-wrap break-words p-4 text-sm">
            <code>{displayContent}</code>
          </pre>
        )}
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
      <div className="flex min-w-0 items-center gap-2 overflow-hidden">
        <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
        {/* Truncates with a hover tooltip carrying the full name — these are
            long uuid-suffixed filenames that never fit the widget. */}
        <TruncatedLabel text={fileName} className="font-mono text-sm" />
        {contentLength !== undefined && (
          <span className="shrink-0 pl-2 text-xs text-muted-foreground">
            {formatFileSize(contentLength)}
          </span>
        )}
      </div>
      <Button
        variant="ghost"
        size="icon"
        className="ml-2 h-7 w-7 shrink-0"
        onClick={onDownload}
        title="Download"
      >
        <Download className="h-4 w-4" />
      </Button>
    </div>
  );
}

interface ImageFileViewProps {
  url: string;
  fileName: string;
  onDownload: () => void;
}

/**
 * Inline image preview. Covers migrated matplotlib figures, which are ordinary
 * raster artifacts and previously hit the binary branch ("Preview not
 * available") purely because nothing routed them here.
 */
function ImageFileView({ url, fileName, onDownload }: ImageFileViewProps) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-muted-foreground">
        <FileText className="h-16 w-16" />
        <p className="text-sm">Could not display this image.</p>
        <Button onClick={onDownload}>
          <Download className="mr-2 h-4 w-4" />
          Download File
        </Button>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto bg-muted/20 p-4">
      <img
        src={url}
        alt={fileName}
        className="max-h-full max-w-full object-contain"
        onError={() => setFailed(true)}
      />
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
  hideTitle = false,
  plainTextFallback,
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
      const response = await fetch(selectedFile.url, {
        signal: AbortSignal.timeout(20000),
      });
      if (!response.ok) {
        throw new Error(`Failed to fetch file: ${response.statusText}`);
      }
      return response.text();
    },
    enabled: !!selectedFile?.url && isPlaintextFile(selectedFile?.fileType || ""),
    retry: 1,
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

  // Plotly / matplotlib figures and 3D point clouds all arrive as plain
  // `.json` under a UUID filename, so the shape identifies them, not the name.
  const media = useMemo(
    () =>
      content && content.length <= MAX_MEDIA_JSON_SIZE
        ? detectMediaJsonText(content)
        : { kind: null, parsed: null },
    [content],
  );

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

  // Viewer selection. Images short-circuit the plaintext path entirely (they
  // are never fetched as text); HTML stays on the plaintext path because it
  // needs its source for srcDoc, but renders as a page rather than as markup.
  const isImage = Boolean(selectedFile && isImageFile(selectedFile.fileType));
  const isHtml = Boolean(selectedFile && isHtmlFile(selectedFile.fileType));
  const isPlaintext =
    !isImage && selectedFile && isPlaintextFile(selectedFile.fileType);
  const isLargeFile = Boolean(content && content.length > MAX_DISPLAY_SIZE);
  const language = selectedFile
    ? getLanguageForExtension(selectedFile.fileType)
    : "text";

  return (
    <div className="flex h-full flex-col space-y-4 p-4">
      {!hideTitle && (
        <h3 className="text-center font-mono text-lg font-medium">
          {log.logName}
        </h3>
      )}

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

            {isImage ? (
              <ImageFileView
                url={selectedFile.url}
                fileName={selectedFile.fileName}
                onDownload={handleDownload}
              />
            ) : isPlaintext ? (
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
                isHtml ? (
                  <SandboxedHtmlView
                    content={content}
                    fileName={selectedFile.fileName}
                  />
                ) : media.kind === "plotly" ? (
                  <PlotlyView figure={media.parsed as PlotlyFigure} />
                ) : media.kind === "point-cloud" ? (
                  <PointCloudView points={media.parsed as number[][]} />
                ) : plainTextFallback ? (
                  <>{plainTextFallback}</>
                ) : (
                  <TextContent
                    content={content}
                    language={language}
                    isLarge={isLargeFile}
                    onDownload={handleDownload}
                  />
                )
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
