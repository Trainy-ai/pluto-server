import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardTitle, CardHeader, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  FileText,
  ChevronDown,
  Download,
  Copy,
  Check,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { useShikiHtml } from "@/lib/hooks/use-shiki";
import type { RunLog } from "@/lib/grouping/types";
import { useGetTextFiles } from "../../~queries/get-text-files";
import {
  isPlaintextFile,
  getLanguageForExtension,
  formatFileSize,
} from "@/lib/file-types";

interface FilesSectionProps {
  logs: RunLog[];
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

export function FilesSection({
  logs,
  tenantId,
  projectName,
  runId,
}: FilesSectionProps) {
  const [expandedLog, setExpandedLog] = useState<string | null>(null);

  // Filter for TEXT, FILE, ARTIFACT log types
  const fileLogs = logs.filter(
    (log) =>
      log.logType === "TEXT" ||
      log.logType === "FILE" ||
      log.logType === "ARTIFACT"
  );

  if (fileLogs.length === 0) {
    return null;
  }

  return (
    <Card className="overflow-hidden border-l-4 border-l-cyan-500">
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2">
          <FileText className="h-5 w-5 text-cyan-500" />
          <div className="space-y-1">
            <CardTitle className="text-xl">Files</CardTitle>
            <p className="text-sm text-muted-foreground">
              Text files, artifacts, and other file logs
            </p>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {fileLogs.map((log) => (
            <FileLogItem
              key={log.id}
              log={log}
              tenantId={tenantId}
              projectName={projectName}
              runId={runId}
              isExpanded={expandedLog === log.logName}
              onToggle={() =>
                setExpandedLog(
                  expandedLog === log.logName ? null : log.logName
                )
              }
            />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

interface FileLogItemProps {
  log: RunLog;
  tenantId: string;
  projectName: string;
  runId: string;
  isExpanded: boolean;
  onToggle: () => void;
}

function FileLogItem({
  log,
  tenantId,
  projectName,
  runId,
  isExpanded,
  onToggle,
}: FileLogItemProps) {
  const { data: files, isLoading: filesLoading } = useGetTextFiles(
    tenantId,
    projectName,
    runId,
    log.logName
  );

  const [selectedFileIndex, setSelectedFileIndex] = useState(0);
  const typedFiles = files as TextFile[] | undefined;
  const selectedFile = typedFiles?.[selectedFileIndex];

  return (
    <Collapsible open={isExpanded} onOpenChange={onToggle}>
      <CollapsibleTrigger asChild>
        <button className="flex w-full items-center justify-between rounded-lg border bg-muted/50 p-3 text-left transition-colors hover:bg-muted/70">
          <div className="flex items-center gap-3">
            <FileText className="h-4 w-4 text-muted-foreground" />
            <div>
              <p className="font-mono text-sm font-medium">{log.logName}</p>
              <p className="text-xs text-muted-foreground">{log.logType}</p>
            </div>
          </div>
          <ChevronDown
            className={`h-4 w-4 text-muted-foreground transition-transform duration-200 ${
              isExpanded ? "rotate-180" : ""
            }`}
          />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-2 rounded-lg border bg-card">
          {filesLoading ? (
            <div className="p-4">
              <Skeleton className="mb-2 h-4 w-full" />
              <Skeleton className="mb-2 h-4 w-3/4" />
              <Skeleton className="h-4 w-5/6" />
            </div>
          ) : !typedFiles || typedFiles.length === 0 ? (
            <div className="p-4 text-center text-sm text-muted-foreground">
              No files found
            </div>
          ) : (
            <>
              <FileContentViewer
                file={selectedFile!}
                onDownload={() => handleDownload(selectedFile!)}
              />
              {typedFiles.length > 1 && (
                <div className="flex items-center justify-center gap-2 border-t p-2">
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-7 w-7"
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedFileIndex(Math.max(0, selectedFileIndex - 1));
                    }}
                    disabled={selectedFileIndex === 0}
                  >
                    <ChevronLeft className="h-3 w-3" />
                  </Button>
                  <span className="font-mono text-xs text-muted-foreground">
                    {selectedFileIndex + 1} / {typedFiles.length}
                  </span>
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-7 w-7"
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedFileIndex(
                        Math.min(typedFiles.length - 1, selectedFileIndex + 1)
                      );
                    }}
                    disabled={selectedFileIndex === typedFiles.length - 1}
                  >
                    <ChevronRight className="h-3 w-3" />
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

async function handleDownload(file: TextFile) {
  if (!file?.url) return;
  try {
    const response = await fetch(file.url);
    if (!response.ok) throw new Error("Failed to fetch file");
    const blob = await response.blob();
    const blobUrl = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = blobUrl;
    link.download = file.fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(blobUrl);
  } catch (error) {
    console.error("Download failed:", error);
    window.open(file.url, "_blank");
  }
}

interface FileContentViewerProps {
  file: TextFile;
  onDownload: () => void;
}

function FileContentViewer({ file, onDownload }: FileContentViewerProps) {
  const [copied, setCopied] = useState(false);
  const isPlaintext = isPlaintextFile(file.fileType);

  const {
    data: content,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["file-content", file.url],
    queryFn: async () => {
      const response = await fetch(file.url);
      if (!response.ok) {
        throw new Error(`Failed to fetch file: ${response.statusText}`);
      }
      return response.text();
    },
    enabled: !!file.url && isPlaintext,
    staleTime: 1000 * 60 * 5,
  });

  const isLarge = content && content.length > MAX_DISPLAY_SIZE;
  const displayContent = useMemo(() => {
    if (!content) return "";
    if (content.length > MAX_DISPLAY_SIZE) {
      return content.slice(0, MAX_DISPLAY_SIZE);
    }
    return content;
  }, [content]);

  const language = getLanguageForExtension(file.fileType);
  const highlightedHtml = useShikiHtml(displayContent, language);

  const handleCopy = () => {
    if (displayContent) {
      navigator.clipboard.writeText(displayContent);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  // Header
  const header = (
    <div className="flex items-center justify-between border-b bg-muted/30 px-3 py-2">
      <div className="flex items-center gap-2 overflow-hidden">
        <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="truncate font-mono text-xs">{file.fileName}</span>
        {content && (
          <span className="shrink-0 text-xs text-muted-foreground">
            {formatFileSize(content.length)}
          </span>
        )}
      </div>
      <div className="flex gap-1">
        {isPlaintext && content && (
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={handleCopy}
          >
            {copied ? (
              <Check className="h-3 w-3" />
            ) : (
              <Copy className="h-3 w-3" />
            )}
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={onDownload}
        >
          <Download className="h-3 w-3" />
        </Button>
      </div>
    </div>
  );

  if (!isPlaintext) {
    return (
      <div>
        {header}
        <div className="flex flex-col items-center justify-center gap-2 p-6 text-muted-foreground">
          <FileText className="h-10 w-10" />
          <p className="text-sm">.{file.fileType} file - Preview not available</p>
          <Button size="sm" onClick={onDownload}>
            <Download className="mr-2 h-3 w-3" />
            Download
          </Button>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div>
        {header}
        <div className="p-4">
          <Skeleton className="mb-2 h-4 w-full" />
          <Skeleton className="mb-2 h-4 w-3/4" />
          <Skeleton className="h-4 w-5/6" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div>
        {header}
        <div className="p-4 text-center text-sm text-destructive">
          Failed to load file content
        </div>
      </div>
    );
  }

  return (
    <div>
      {header}
      {isLarge && (
        <div className="flex items-center justify-between border-b bg-yellow-500/10 px-3 py-1.5 text-xs text-yellow-600 dark:text-yellow-400">
          <span>Large file truncated. Preview limited to {formatFileSize(MAX_DISPLAY_SIZE)}.</span>
          <Button variant="link" size="sm" className="h-auto p-0 text-xs" onClick={onDownload}>
            Download full file
          </Button>
        </div>
      )}
      <div className="max-h-[300px] overflow-auto">
        {highlightedHtml ? (
          <div
            className="shiki-wrapper line-numbers p-3 text-xs"
            dangerouslySetInnerHTML={{ __html: highlightedHtml }}
          />
        ) : (
          <pre className="p-3 text-xs">
            <code>{displayContent}</code>
          </pre>
        )}
      </div>
    </div>
  );
}
