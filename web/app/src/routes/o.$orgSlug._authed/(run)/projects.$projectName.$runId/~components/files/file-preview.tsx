import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Download,
  Copy,
  Check,
  FileText,
  Image,
  Film,
  Music,
  File,
  ZoomIn,
  ZoomOut,
  RotateCcw,
} from "lucide-react";
import { useShikiHtml } from "@/lib/hooks/use-shiki";
import {
  isPlaintextFile,
  getLanguageForExtension,
  formatFileSize,
} from "@/lib/file-types";
import type { FileEntry } from "./file-tree";
import { useGetFileUrl } from "../../~queries/get-file-url";

interface FilePreviewProps {
  file: FileEntry;
  organizationId: string;
  projectName: string;
  runId: string;
}

const MAX_DISPLAY_SIZE = 500 * 1024; // 500KB

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "bmp", "svg", "webp", "ico"]);
const VIDEO_EXTENSIONS = new Set(["mp4", "avi", "mov", "mkv", "webm"]);
const AUDIO_EXTENSIONS = new Set(["mp3", "wav", "ogg", "flac", "aac", "m4a"]);

function getFileCategory(fileType: string): "image" | "video" | "audio" | "text" | "binary" {
  const ext = fileType.toLowerCase();
  if (IMAGE_EXTENSIONS.has(ext)) return "image";
  if (VIDEO_EXTENSIONS.has(ext)) return "video";
  if (AUDIO_EXTENSIONS.has(ext)) return "audio";
  if (isPlaintextFile(ext)) return "text";
  return "binary";
}

function getFileTypeIcon(fileType: string) {
  const category = getFileCategory(fileType);
  switch (category) {
    case "image": return Image;
    case "video": return Film;
    case "audio": return Music;
    case "text": return FileText;
    default: return File;
  }
}

async function handleDownload(url: string, fileName: string) {
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error("Failed to fetch file");
    const blob = await response.blob();
    const blobUrl = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = blobUrl;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(blobUrl);
  } catch (error) {
    console.error("Download failed:", error);
    window.open(url, "_blank");
  }
}

function ImagePreview({ url, fileName }: { url: string; fileName: string }) {
  const [scale, setScale] = useState(1);

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex items-center justify-center gap-2 border-b bg-muted/30 px-3 py-1.5">
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={() => setScale(Math.max(0.25, scale - 0.25))}
          disabled={scale <= 0.25}
        >
          <ZoomOut className="h-3.5 w-3.5" />
        </Button>
        <span className="min-w-[50px] text-center text-xs text-muted-foreground">
          {Math.round(scale * 100)}%
        </span>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={() => setScale(Math.min(8, scale + 0.25))}
          disabled={scale >= 8}
        >
          <ZoomIn className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={() => setScale(1)}
        >
          <RotateCcw className="h-3.5 w-3.5" />
        </Button>
      </div>
      <div className="flex flex-1 items-center justify-center overflow-auto bg-[repeating-conic-gradient(#80808015_0%_25%,transparent_0%_50%)] bg-[length:20px_20px] p-4">
        <img
          src={url}
          alt={fileName}
          className="max-h-full max-w-full object-contain"
          style={{ transform: `scale(${scale})`, transformOrigin: "center" }}
          draggable={false}
        />
      </div>
    </div>
  );
}

function VideoPreview({ url }: { url: string }) {
  return (
    <div className="flex flex-1 items-center justify-center overflow-auto bg-black/5 p-4">
      <video
        src={url}
        controls
        className="max-h-full max-w-full"
      />
    </div>
  );
}

function AudioPreview({ url, fileName }: { url: string; fileName: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8">
      <Music className="h-16 w-16 text-muted-foreground" />
      <p className="font-mono text-sm text-muted-foreground">{fileName}</p>
      <audio src={url} controls className="w-full max-w-md" />
    </div>
  );
}

function TextPreview({ url, file }: { url: string; file: FileEntry }) {
  const [copied, setCopied] = useState(false);

  const {
    data: content,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["file-content", url],
    queryFn: async () => {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to fetch file: ${response.statusText}`);
      }
      return response.text();
    },
    enabled: !!url,
    staleTime: 1000 * 60 * 5,
  });

  const displayContent = useMemo(() => {
    if (!content) return "";
    if (content.length > MAX_DISPLAY_SIZE) {
      return content.slice(0, MAX_DISPLAY_SIZE);
    }
    return content;
  }, [content]);

  const isLarge = content && content.length > MAX_DISPLAY_SIZE;
  const language = getLanguageForExtension(file.fileType);
  const highlightedHtml = useShikiHtml(displayContent, language);

  const handleCopy = () => {
    if (displayContent) {
      navigator.clipboard.writeText(displayContent);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  if (isLoading) {
    return (
      <div className="flex-1 p-4">
        <Skeleton className="mb-2 h-4 w-full" />
        <Skeleton className="mb-2 h-4 w-3/4" />
        <Skeleton className="h-4 w-5/6" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-destructive">
        Failed to load file content
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex items-center gap-2 border-b bg-muted/30 px-3 py-1.5">
        {content && (
          <span className="text-xs text-muted-foreground">
            {formatFileSize(content.length)}
          </span>
        )}
        {isLarge && (
          <span className="text-xs text-yellow-600 dark:text-yellow-400">
            (truncated to {formatFileSize(MAX_DISPLAY_SIZE)})
          </span>
        )}
        <div className="ml-auto">
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
        </div>
      </div>
      <div className="flex-1 overflow-auto">
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

function BinaryPreview({ url, file }: { url: string; file: FileEntry }) {
  const FileIcon = getFileTypeIcon(file.fileType);
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8">
      <FileIcon className="h-16 w-16 text-muted-foreground" />
      <div className="text-center">
        <p className="font-mono text-sm font-medium">{file.fileName}</p>
        <p className="text-xs text-muted-foreground">
          .{file.fileType} file - {formatFileSize(file.fileSize)}
        </p>
      </div>
      <Button size="sm" onClick={() => handleDownload(url, file.fileName)}>
        <Download className="mr-2 h-3 w-3" />
        Download
      </Button>
    </div>
  );
}

export function FilePreview({
  file,
  organizationId,
  projectName,
  runId,
}: FilePreviewProps) {
  const { data: urlData, isLoading: urlLoading } = useGetFileUrl(
    organizationId,
    projectName,
    runId,
    file.logName,
    file.fileName,
  );

  const url = urlData?.url;
  const category = getFileCategory(file.fileType);

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b px-4 py-2">
        <div className="flex items-center gap-2 overflow-hidden">
          <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="truncate font-mono text-sm">{file.logName}/{file.fileName}</span>
          <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
            Step {file.step}
          </span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="shrink-0 gap-1.5"
          disabled={!url}
          onClick={() => url && handleDownload(url, file.fileName)}
        >
          <Download className="h-3.5 w-3.5" />
          Download
        </Button>
      </div>

      {/* Content */}
      {urlLoading || !url ? (
        <div className="flex flex-1 items-center justify-center">
          <Skeleton className="h-48 w-48" />
        </div>
      ) : (
        <>
          {category === "image" && <ImagePreview url={url} fileName={file.fileName} />}
          {category === "video" && <VideoPreview url={url} />}
          {category === "audio" && <AudioPreview url={url} fileName={file.fileName} />}
          {category === "text" && <TextPreview url={url} file={file} />}
          {category === "binary" && <BinaryPreview url={url} file={file} />}
        </>
      )}
    </div>
  );
}
