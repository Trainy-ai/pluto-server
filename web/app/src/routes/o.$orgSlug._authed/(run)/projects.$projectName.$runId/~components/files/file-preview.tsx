import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { trpc } from "@/utils/trpc";
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
  isImageFile,
  isHtmlFile,
  getLanguageForExtension,
  formatFileSize,
} from "@/lib/file-types";
import { isJsonString, tryPrettyPrintJson } from "@/lib/json-format";
import {
  detectMediaJsonText,
  MAX_MEDIA_JSON_SIZE,
  type PlotlyFigure,
} from "@/lib/media-json";
import {
  AnnotatedImage,
  compositeAnnotatedImage,
} from "@/components/media/annotated-image";
import { parseAnnotations } from "@/lib/image-annotations";
import {
  useMaskUrlFromEntries,
  type MaskUrlResolver,
} from "@/hooks/use-mask-url";
import {
  downloadImageWithCaption,
  type ExportCaption,
} from "@/components/charts/chart-export-utils";
import { PlotlyView } from "@/components/media/plotly-view";
import { PointCloudView } from "@/components/media/point-cloud-view";
import { SandboxedHtmlView } from "@/components/media/sandboxed-html-view";
import type { FileEntry } from "./file-tree";
import { RendererErrorBoundary } from "@/components/shared/renderer-error-boundary";
import { useGetFileUrl } from "../../~queries/get-file-url";

interface FilePreviewProps {
  file: FileEntry;
  organizationId: string;
  projectName: string;
  runId: string;
  /** The run being browsed, for the download caption strip. */
  run?: { name?: string | null; displayId?: string | null } | null;
}

/**
 * Chip colour for the download strip. The individual-run page has no per-run
 * palette (that is an all-runs concept, where colour distinguishes series), so
 * one neutral accent is used rather than inventing a colour.
 */
const RUN_CHIP_COLOR = "#60a5fa";

const MAX_DISPLAY_SIZE = 500 * 1024; // 500KB

// The media-JSON sniff cap lives with the sniffer (MAX_MEDIA_JSON_SIZE in
// lib/media-json), so this tab and the group viewer cannot disagree about which
// files are big enough to skip — they used to, and the same figure rendered as
// a chart here and as raw text there.

// Image extensions come from lib/file-types (isImageFile) so this tab and the
// group viewer cannot drift apart on what counts as previewable.
const VIDEO_EXTENSIONS = new Set(["mp4", "avi", "mov", "mkv", "webm"]);
const AUDIO_EXTENSIONS = new Set(["mp3", "wav", "ogg", "flac", "aac", "m4a"]);

function getFileCategory(
  fileType: string,
): "image" | "video" | "audio" | "html" | "text" | "binary" {
  const ext = fileType.toLowerCase();
  if (isImageFile(ext)) return "image";
  if (VIDEO_EXTENSIONS.has(ext)) return "video";
  if (AUDIO_EXTENSIONS.has(ext)) return "audio";
  // Before "text": html IS plaintext, but a migrated wandb.Html artifact is
  // meant to be seen as a page, not read as markup.
  if (isHtmlFile(ext)) return "html";
  if (isPlaintextFile(ext)) return "text";
  return "binary";
}

function getFileTypeIcon(fileType: string) {
  const category = getFileCategory(fileType);
  switch (category) {
    case "image": return Image;
    case "video": return Film;
    case "audio": return Music;
    case "html": return FileText;
    case "text": return FileText;
    default: return File;
  }
}

async function handleDownload(
  url: string,
  fileName: string,
  caption?: ExportCaption,
  container?: HTMLElement | null,
) {
  // Same caption strip as the run page: a UUID-named PNG in a downloads folder
  // is otherwise unidentifiable.
  if (caption) {
    try {
      await downloadImageWithCaption(url, fileName, caption, container);
      return;
    } catch (error) {
      console.error("Caption-stamped download failed, falling back to raw:", error);
    }
  }
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

function ImagePreview({
  url,
  fileName,
  file,
  maskUrl,
  onDownloadSource,
}: {
  url: string;
  fileName: string;
  file: FileEntry;
  maskUrl?: MaskUrlResolver;
  /**
   * Hands the parent a flattened PNG of what is on screen, overlays included.
   * Called with null on unmount — see the effect below.
   */
  onDownloadSource?: (fn: (() => Promise<string>) | null) => void;
}) {
  const [scale, setScale] = useState(1);
  const previewRef = useRef<HTMLDivElement | null>(null);
  // Same overlays as the run page — the file browser previously showed the bare
  // picture, so an annotated image looked unannotated here alone.
  const annotations = useMemo(
    () => parseAnnotations(file.annotations),
    [file.annotations],
  );

  // The download button lives in the parent's header, so hand it a way to
  // flatten this view. Without it the button re-fetched the raw file and the
  // saved PNG had none of the overlays on screen.
  //
  // The cleanup is not housekeeping: the parent outlives this component, so
  // without it, selecting a text file after an image left the parent holding a
  // closure over the *image's* URL, and downloading the text file saved the
  // previous picture under the text file's name.
  useEffect(() => {
    if (!onDownloadSource) return;
    onDownloadSource(async () =>
      (annotations ? await compositeAnnotatedImage(previewRef.current) : null) ?? url,
    );
    return () => onDownloadSource(null);
  }, [onDownloadSource, annotations, url]);

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
      <div
        ref={previewRef}
        className="flex flex-1 items-center justify-center overflow-auto bg-[repeating-conic-gradient(#80808015_0%_25%,transparent_0%_50%)] bg-[length:20px_20px] p-4"
      >
        {annotations ? (
          <AnnotatedImage
            src={url}
            alt={fileName}
            annotations={annotations}
            maskUrl={maskUrl}
            showLayerToggles
            className="max-h-full"
            imgClassName="h-auto w-auto max-h-full max-w-full"
            // On the wrapper so the overlays scale with the picture. Applied to
            // the image alone, zoom moved the photo and left the boxes behind.
            wrapperStyle={{ transform: `scale(${scale})`, transformOrigin: "center" }}
          />
        ) : (
          <img
            src={url}
            alt={fileName}
            className="max-h-full max-w-full object-contain"
            style={{ transform: `scale(${scale})`, transformOrigin: "center" }}
            draggable={false}
          />
        )}
      </div>
      {/* The caption is stored per file but was only ever shown on the run
          page; a file browser is exactly where you want to know what a
          UUID-named image actually is. */}
      {file.caption && (
        <div className="border-t bg-muted/20 px-3 py-1.5 text-center text-xs text-muted-foreground">
          {file.caption}
        </div>
      )}
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
      const response = await fetch(url, { signal: AbortSignal.timeout(20000) });
      if (!response.ok) {
        throw new Error(`Failed to fetch file: ${response.statusText}`);
      }
      return response.text();
    },
    enabled: !!url,
    retry: 1,
    staleTime: 1000 * 60 * 5,
  });

  // A wandb Plotly / matplotlib figure or a 3D point cloud arrives as plain
  // `.json` under a UUID filename — the original `.plotly.json` / `.pts.json`
  // suffix is gone — so the shape is what identifies it. Recognised ones get a
  // real viewer instead of a wall of numbers.
  const media = useMemo(
    () =>
      content && content.length <= MAX_MEDIA_JSON_SIZE
        ? detectMediaJsonText(content)
        : { kind: null, parsed: null },
    [content],
  );

  const displayContent = useMemo(() => {
    if (!content) return "";
    // Minified JSON arrives as one enormous line, which rendered as a single
    // unreadable row running off the right edge. Pretty-print it before
    // truncating so the size cap applies to what is actually shown.
    const pretty = isJsonString(content) ? tryPrettyPrintJson(content) : content;
    if (pretty.length > MAX_DISPLAY_SIZE) {
      return pretty.slice(0, MAX_DISPLAY_SIZE);
    }
    return pretty;
  }, [content]);

  const isLarge = content && content.length > MAX_DISPLAY_SIZE;
  const language = getLanguageForExtension(file.fileType);
  const highlightedHtml = useShikiHtml(displayContent, language);

  // Below the hooks, not above: `content` arrives asynchronously, so an early
  // return keyed on it changes the hook count between renders (React #300).
  if (media.kind === "plotly") {
    return (
      <div className="h-[540px] w-full">
        <PlotlyView figure={media.parsed as PlotlyFigure} />
      </div>
    );
  }
  if (media.kind === "point-cloud") {
    return (
      <div className="h-[540px] w-full">
        <PointCloudView points={media.parsed as number[][]} />
      </div>
    );
  }

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
      <div className="min-w-0 flex-1 overflow-x-auto overflow-y-auto">
        {highlightedHtml ? (
          <div
            className="shiki-wrapper wrap-long-lines line-numbers p-3 text-xs"
            dangerouslySetInnerHTML={{ __html: highlightedHtml }}
          />
        ) : (
          <pre className="whitespace-pre-wrap break-words p-3 text-xs">
            <code>{displayContent}</code>
          </pre>
        )}
      </div>
    </div>
  );
}

/**
 * Fetches an HTML artifact and hands it to the shared sandboxed viewer.
 *
 * Only the fetch and its loading/error states live here — the frame, its
 * sandbox flags and the source toggle are in `SandboxedHtmlView`, shared with
 * the group viewer so the security-relevant attributes exist in one place.
 */
function HtmlPreview({ url, file }: { url: string; file: FileEntry }) {
  const { data: content, isLoading, error } = useQuery({
    queryKey: ["file-content", url],
    queryFn: async () => {
      const response = await fetch(url, { signal: AbortSignal.timeout(20000) });
      if (!response.ok) {
        throw new Error(`Failed to fetch file: ${response.statusText}`);
      }
      return response.text();
    },
    enabled: !!url,
    retry: 1,
    staleTime: 1000 * 60 * 5,
  });

  if (isLoading) {
    return (
      <div className="flex-1 p-4">
        <Skeleton className="mb-2 h-4 w-full" />
        <Skeleton className="mb-2 h-4 w-3/4" />
        <Skeleton className="h-4 w-5/6" />
      </div>
    );
  }

  if (error || !content) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-destructive">
        Failed to load file content
      </div>
    );
  }

  return <SandboxedHtmlView content={content} fileName={file.fileName} compact />;
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
  run,
}: FilePreviewProps) {
  const runDisplayName = run?.displayId
    ? `${run.name} (${run.displayId})`
    : (run?.name ?? "");
  const { data: urlData, isLoading: urlLoading } = useGetFileUrl(
    organizationId,
    projectName,
    runId,
    file.logName,
    file.fileName,
  );

  const url = urlData?.url;
  const category = getFileCategory(file.fileType);

  // Masks live in separate files, and presigned URLs are signed per object key,
  // so each has to be fetched rather than derived from this one.
  const maskFileNames = useMemo(() => {
    const parsed = parseAnnotations(file.annotations);
    return Object.values(parsed?.masks ?? {})
      .map((layer) => layer.fileName)
      .filter((name): name is string => !!name);
  }, [file.annotations]);

  // One query per mask layer, via `useQueries` so the count can follow the
  // data. This replaced three hardcoded `useGetFileUrl` calls, which both
  // dropped any fourth layer on the floor and — because every file preview ran
  // all three unconditionally with `?? ""` — asked the server to presign an
  // empty object key for every text, video and binary file browsed.
  const maskQueries = useQueries({
    queries: maskFileNames.map((fileName) => ({
      ...trpc.runs.data.fileUrl.queryOptions({
        organizationId,
        projectName,
        runId,
        logName: file.logName,
        fileName,
      }),
      staleTime: 1000 * 60 * 10, // URLs stay valid far longer; matches useGetFileUrl
    })),
  });
  const maskUrl: MaskUrlResolver = useMaskUrlFromEntries(
    maskFileNames.map((name, i) => [name, maskQueries[i]?.data?.url]),
  );

  const downloadSourceRef = useRef<null | (() => Promise<string>)>(null);
  const setDownloadSource = useCallback(
    (fn: (() => Promise<string>) | null) => { downloadSourceRef.current = fn; },
    [],
  );
  // Resolves the page theme so the download's caption strip matches what was on
  // screen (dark band on dark theme). Must stay attached to a real element —
  // it was previously declared and never wired up, so the strip always fell
  // back to the document default.
  const previewContainerRef = useRef<HTMLDivElement | null>(null);

  const runDownload = async () => {
    // Flattening can reject (the box overlay failing to rasterise, for one);
    // fall back to the raw file rather than leaving the button doing nothing.
    let src = url;
    try {
      src = (await downloadSourceRef.current?.()) ?? url;
    } catch (error) {
      console.error("Failed to flatten annotations for download:", error);
    }
    if (!src) return;
    await handleDownload(
      src,
      file.fileName,
      {
        // ExportCaption has no field for the image's own caption, so it rides
        // on the step line — "step 2 · daylight — epoch 1" identifies the file
        // better than either half alone.
        step: file.caption
          ? `step ${file.step} · ${file.caption}`
          : `step ${file.step}`,
        runs: run?.name
          ? [{ name: runDisplayName, color: RUN_CHIP_COLOR }]
          : undefined,
      },
      previewContainerRef.current,
    );
  };

  return (
    <div ref={previewContainerRef} className="flex h-full flex-col">
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
          onClick={() => void runDownload()}
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
        <RendererErrorBoundary
          // Clears a caught error when the selection moves to another file,
          // without remounting the preview — `key` here would also reset the
          // image zoom on every step change.
          resetKey={`${file.logName}/${file.fileName}`}
          label={file.fileName}
          // Same path as the header button, so the escape-hatch download gets
          // the caption strip and the overlays too.
          onDownload={() => void runDownload()}
        >
          {category === "image" && (
            <ImagePreview
              url={url}
              fileName={file.fileName}
              file={file}
              maskUrl={maskUrl}
              onDownloadSource={setDownloadSource}
            />
          )}
          {category === "video" && <VideoPreview url={url} />}
          {category === "audio" && <AudioPreview url={url} fileName={file.fileName} />}
          {category === "html" && <HtmlPreview url={url} file={file} />}
          {category === "text" && <TextPreview url={url} file={file} />}
          {category === "binary" && <BinaryPreview url={url} file={file} />}
        </RendererErrorBoundary>
      )}
    </div>
  );
}
