import { useState, useMemo } from "react";
import {
  ChevronRight,
  ChevronDown,
  Folder,
  FolderOpen,
  FileText,
  Image,
  Film,
  Music,
  File,
  Activity,
  TrendingUp,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatFileSize, isPlaintextFile } from "@/lib/file-types";
import { ScrollArea } from "@/components/ui/scroll-area";

export interface FileEntry {
  fileName: string;
  fileType: string;
  fileSize: number;
  logName: string;
  logGroup: string;
  time: string;
  step: number;
}

export interface MetricEntry {
  logName: string;
  lastValue: number;
  minValue: number;
  maxValue: number;
  avgValue: number;
  count: number;
}

export interface TreeNode {
  name: string;
  type: "folder" | "file";
  path: string;
  children?: TreeNode[];
  file?: FileEntry;
  /** All files at this logName, sorted by step (for multi-step navigation) */
  files?: FileEntry[];
  fileCount?: number;
}

interface MetricTreeNode {
  name: string;
  type: "folder" | "metric";
  path: string;
  children?: MetricTreeNode[];
  metric?: MetricEntry;
  metricCount?: number;
}

interface FileTreeProps {
  files: FileEntry[];
  metrics?: MetricEntry[];
  selectedFile: FileEntry | null;
  selectedMetric?: MetricEntry | null;
  onSelectFile: (file: FileEntry, allFiles?: FileEntry[]) => void;
  onMetricClick?: (metric: MetricEntry) => void;
}

function getFileIcon(fileType: string) {
  const imageTypes = new Set(["png", "jpg", "jpeg", "gif", "bmp", "svg", "webp", "ico"]);
  const videoTypes = new Set(["mp4", "avi", "mov", "mkv", "webm"]);
  const audioTypes = new Set(["mp3", "wav", "ogg", "flac", "aac", "m4a"]);

  const ext = fileType.toLowerCase();
  if (imageTypes.has(ext)) return Image;
  if (videoTypes.has(ext)) return Film;
  if (audioTypes.has(ext)) return Music;
  if (isPlaintextFile(ext)) return FileText;
  return File;
}

// ---------------------------------------------------------------------------
// File tree builders
// ---------------------------------------------------------------------------

function buildTree(files: FileEntry[]): TreeNode[] {
  // Group files by logName first, so each logName becomes a single leaf node
  // with all its files (at different steps) attached for step navigation.
  const byLogName = new Map<string, FileEntry[]>();
  for (const file of files) {
    const existing = byLogName.get(file.logName);
    if (existing) {
      existing.push(file);
    } else {
      byLogName.set(file.logName, [file]);
    }
  }

  const root: TreeNode = {
    name: "root",
    type: "folder",
    path: "",
    children: [],
  };

  for (const [logName, logFiles] of byLogName) {
    // Sort files by step ascending for step navigation
    const sorted = [...logFiles].sort((a, b) => a.step - b.step);
    const parts = logName.split("/");
    let currentNode = root;

    // All parts except the last become folders; the last part is the file leaf
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      let childNode = currentNode.children!.find(
        (child) => child.name === part && child.type === "folder",
      );

      if (!childNode) {
        childNode = {
          name: part,
          type: "folder",
          path: currentNode.path ? `${currentNode.path}/${part}` : part,
          children: [],
        };
        currentNode.children!.push(childNode);
      }
      currentNode = childNode;
    }

    const leafName = parts[parts.length - 1];
    currentNode.children!.push({
      name: leafName,
      type: "file",
      path: logName,
      file: sorted[0], // Default to first (lowest) step
      files: sorted,
    });
  }

  function calculateFileCounts(node: TreeNode): number {
    if (node.type === "file") {
      return 1;
    }
    const count =
      node.children?.reduce(
        (acc, child) => acc + calculateFileCounts(child),
        0,
      ) || 0;
    node.fileCount = count;
    return count;
  }

  calculateFileCounts(root);
  return root.children!;
}

function sortTree(nodes: TreeNode[]): TreeNode[] {
  return nodes
    .map((node) => ({
      ...node,
      children: node.children ? sortTree(node.children) : undefined,
    }))
    .sort((a, b) => {
      if (a.type !== b.type) {
        return a.type === "folder" ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });
}

// ---------------------------------------------------------------------------
// Metric tree builders
// ---------------------------------------------------------------------------

function buildMetricTree(metrics: MetricEntry[]): MetricTreeNode[] {
  const root: MetricTreeNode = {
    name: "root",
    type: "folder",
    path: "",
    children: [],
  };

  for (const metric of metrics) {
    const parts = metric.logName.split("/");
    let currentNode = root;

    // All parts except the last are folders, the last is the metric leaf
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      let childNode = currentNode.children!.find(
        (child) => child.name === part && child.type === "folder",
      );

      if (!childNode) {
        childNode = {
          name: part,
          type: "folder",
          path: currentNode.path ? `${currentNode.path}/${part}` : part,
          children: [],
        };
        currentNode.children!.push(childNode);
      }
      currentNode = childNode;
    }

    const leafName = parts[parts.length - 1];
    currentNode.children!.push({
      name: leafName,
      type: "metric",
      path: metric.logName,
      metric,
    });
  }

  function calculateMetricCounts(node: MetricTreeNode): number {
    if (node.type === "metric") {
      return 1;
    }
    const count =
      node.children?.reduce(
        (acc, child) => acc + calculateMetricCounts(child),
        0,
      ) || 0;
    node.metricCount = count;
    return count;
  }

  calculateMetricCounts(root);
  return root.children!;
}

function sortMetricTree(nodes: MetricTreeNode[]): MetricTreeNode[] {
  return nodes
    .map((node) => ({
      ...node,
      children: node.children ? sortMetricTree(node.children) : undefined,
    }))
    .sort((a, b) => {
      if (a.type !== b.type) {
        return a.type === "folder" ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });
}

// ---------------------------------------------------------------------------
// Format helpers
// ---------------------------------------------------------------------------

function formatMetricValue(value: number): string {
  if (!Number.isFinite(value)) {
    return String(value);
  }
  const abs = Math.abs(value);
  if (abs === 0) {
    return "0";
  }
  if (abs >= 1e6 || abs < 1e-4) {
    return value.toExponential(3);
  }
  // Show up to 6 significant digits, but cap at 8 chars total
  const formatted = Number(value.toPrecision(6)).toString();
  if (formatted.length > 8) {
    return value.toExponential(2);
  }
  return formatted;
}

// ---------------------------------------------------------------------------
// File tree node component
// ---------------------------------------------------------------------------

interface TreeNodeItemProps {
  node: TreeNode;
  depth: number;
  selectedFile: FileEntry | null;
  onSelectFile: (file: FileEntry, allFiles?: FileEntry[]) => void;
  expandedPaths: Set<string>;
  onToggle: (path: string) => void;
}

function TreeNodeItem({
  node,
  depth,
  selectedFile,
  onSelectFile,
  expandedPaths,
  onToggle,
}: TreeNodeItemProps) {
  const isExpanded = expandedPaths.has(node.path);
  const isSelected =
    node.type === "file" &&
    node.file &&
    selectedFile &&
    node.file.logName === selectedFile.logName;

  if (node.type === "folder") {
    return (
      <div>
        <button
          onClick={() => onToggle(node.path)}
          className={cn(
            "flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-sm hover:bg-muted/70",
          )}
          style={{ paddingLeft: `${depth * 16 + 8}px` }}
        >
          {isExpanded ? (
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          )}
          {isExpanded ? (
            <FolderOpen className="h-4 w-4 shrink-0 text-amber-500" />
          ) : (
            <Folder className="h-4 w-4 shrink-0 text-amber-500" />
          )}
          <span className="truncate font-medium">{node.name}</span>
          {node.fileCount != null && (
            <span className="ml-auto shrink-0 text-xs text-muted-foreground">
              {node.fileCount}
            </span>
          )}
        </button>
        {isExpanded && node.children && (
          <div>
            {node.children.map((child) => (
              <TreeNodeItem
                key={child.path}
                node={child}
                depth={depth + 1}
                selectedFile={selectedFile}
                onSelectFile={onSelectFile}
                expandedPaths={expandedPaths}
                onToggle={onToggle}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  // File node
  const FileIcon = getFileIcon(node.file?.fileType || "");
  const uniqueSteps = node.files
    ? new Set(node.files.map((f) => f.step)).size
    : 1;
  return (
    <button
      onClick={() => node.file && onSelectFile(node.file, node.files)}
      className={cn(
        "flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-sm hover:bg-muted/70",
        isSelected && "bg-primary/10 text-primary",
      )}
      style={{ paddingLeft: `${depth * 16 + 8 + 18}px` }}
    >
      <FileIcon className={cn("h-4 w-4 shrink-0", isSelected ? "text-primary" : "text-muted-foreground")} />
      <span className="truncate">{node.name}</span>
      <span className="ml-auto shrink-0 text-xs text-muted-foreground">
        {uniqueSteps > 1
          ? `${uniqueSteps} steps`
          : node.file
            ? formatFileSize(node.file.fileSize)
            : ""}
      </span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Metric tree node component
// ---------------------------------------------------------------------------

interface MetricTreeNodeItemProps {
  node: MetricTreeNode;
  depth: number;
  expandedPaths: Set<string>;
  onToggle: (path: string) => void;
  selectedMetric?: MetricEntry | null;
  onMetricClick?: (metric: MetricEntry) => void;
}

function MetricTreeNodeItem({
  node,
  depth,
  expandedPaths,
  onToggle,
  selectedMetric,
  onMetricClick,
}: MetricTreeNodeItemProps) {
  const isExpanded = expandedPaths.has(`metric:${node.path}`);

  if (node.type === "folder") {
    return (
      <div>
        <button
          onClick={() => onToggle(`metric:${node.path}`)}
          className="flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-sm hover:bg-muted/70"
          style={{ paddingLeft: `${depth * 16 + 8}px` }}
        >
          {isExpanded ? (
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          )}
          {isExpanded ? (
            <FolderOpen className="h-4 w-4 shrink-0 text-amber-500" />
          ) : (
            <Folder className="h-4 w-4 shrink-0 text-amber-500" />
          )}
          <span className="truncate font-medium">{node.name}</span>
          {node.metricCount != null && (
            <span className="ml-auto shrink-0 text-xs text-muted-foreground">
              {node.metricCount}
            </span>
          )}
        </button>
        {isExpanded && node.children && (
          <div>
            {node.children.map((child) => (
              <MetricTreeNodeItem
                key={child.path}
                node={child}
                depth={depth + 1}
                expandedPaths={expandedPaths}
                onToggle={onToggle}
                selectedMetric={selectedMetric}
                onMetricClick={onMetricClick}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  // Metric leaf node
  const isClickable = !!onMetricClick && !!node.metric;
  const isMetricSelected =
    selectedMetric && node.metric && selectedMetric.logName === node.metric.logName;
  return (
    <button
      onClick={() => isClickable && onMetricClick!(node.metric!)}
      className={cn(
        "flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-sm",
        isClickable && "cursor-pointer hover:bg-muted/70",
        isMetricSelected && "bg-primary/10",
      )}
      style={{ paddingLeft: `${depth * 16 + 8 + 18}px` }}
      title={`min: ${node.metric?.minValue}  max: ${node.metric?.maxValue}  avg: ${formatMetricValue(node.metric?.avgValue ?? 0)}  count: ${node.metric?.count}`}
    >
      <TrendingUp className={cn("h-4 w-4 shrink-0", isMetricSelected ? "text-primary" : "text-blue-500")} />
      <span className={cn("truncate", isMetricSelected ? "text-primary" : "text-muted-foreground")}>{node.name}</span>
      <span className={cn("ml-auto shrink-0 font-mono text-xs tabular-nums", isMetricSelected && "text-primary")}>
        {formatMetricValue(node.metric?.lastValue ?? 0)}
      </span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Section header component
// ---------------------------------------------------------------------------

interface SectionHeaderProps {
  label: string;
  icon: React.ReactNode;
  count: number;
  isExpanded: boolean;
  onToggle: () => void;
}

function SectionHeader({ label, icon, count, isExpanded, onToggle }: SectionHeaderProps) {
  return (
    <button
      onClick={onToggle}
      className="flex w-full items-center gap-1.5 border-b bg-muted/30 px-3 py-1.5 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground hover:bg-muted/50"
    >
      {isExpanded ? (
        <ChevronDown className="h-3 w-3 shrink-0" />
      ) : (
        <ChevronRight className="h-3 w-3 shrink-0" />
      )}
      {icon}
      <span>{label}</span>
      <span className="ml-auto shrink-0 text-[10px] font-normal">{count}</span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Main FileTree component
// ---------------------------------------------------------------------------

export function FileTree({
  files,
  metrics,
  selectedFile,
  selectedMetric,
  onSelectFile,
  onMetricClick,
}: FileTreeProps) {
  const fileTree = useMemo(() => sortTree(buildTree(files)), [files]);
  const metricTree = useMemo(
    () => (metrics && metrics.length > 0 ? sortMetricTree(buildMetricTree(metrics)) : []),
    [metrics],
  );

  const hasMetrics = metricTree.length > 0;
  const hasFiles = files.length > 0;

  // Auto-expand top-level folders for both trees
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(() => {
    const paths = new Set<string>();
    for (const node of fileTree) {
      paths.add(node.path);
    }
    for (const node of metricTree) {
      paths.add(`metric:${node.path}`);
    }
    return paths;
  });

  const [metricsExpanded, setMetricsExpanded] = useState(true);
  const [filesExpanded, setFilesExpanded] = useState(true);

  const handleToggle = (path: string) => {
    setExpandedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };

  return (
    <ScrollArea className="h-full">
      {/* Metrics section */}
      {hasMetrics && (
        <div>
          <SectionHeader
            label="Metrics"
            icon={<Activity className="h-3 w-3 shrink-0" />}
            count={metrics!.length}
            isExpanded={metricsExpanded}
            onToggle={() => setMetricsExpanded((p) => !p)}
          />
          {metricsExpanded && (
            <div className="py-1">
              {metricTree.map((node) => (
                <MetricTreeNodeItem
                  key={node.path}
                  node={node}
                  depth={0}
                  expandedPaths={expandedPaths}
                  onToggle={handleToggle}
                  selectedMetric={selectedMetric}
                  onMetricClick={onMetricClick}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Files section */}
      {hasFiles && (
        <div>
          {hasMetrics && (
            <SectionHeader
              label="Files"
              icon={<File className="h-3 w-3 shrink-0" />}
              count={files.length}
              isExpanded={filesExpanded}
              onToggle={() => setFilesExpanded((p) => !p)}
            />
          )}
          {filesExpanded && (
            <div className="py-1">
              {fileTree.map((node) => (
                <TreeNodeItem
                  key={node.path}
                  node={node}
                  depth={0}
                  selectedFile={selectedFile}
                  onSelectFile={onSelectFile}
                  expandedPaths={expandedPaths}
                  onToggle={handleToggle}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </ScrollArea>
  );
}
