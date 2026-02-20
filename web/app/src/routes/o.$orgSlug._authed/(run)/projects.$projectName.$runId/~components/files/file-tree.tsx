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

export interface TreeNode {
  name: string;
  type: "folder" | "file";
  path: string;
  children?: TreeNode[];
  file?: FileEntry;
  fileCount?: number;
}

interface FileTreeProps {
  files: FileEntry[];
  selectedFile: FileEntry | null;
  onSelectFile: (file: FileEntry) => void;
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

function buildTree(files: FileEntry[]): TreeNode[] {
  const root: TreeNode = {
    name: "root",
    type: "folder",
    path: "",
    children: [],
  };

  for (const file of files) {
    const parts = file.logName.split("/");
    let currentNode = root;

    for (const part of parts) {
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

    const filePath = `${file.logName}/${file.fileName}`;
    if (!currentNode.children!.find((child) => child.path === filePath)) {
      currentNode.children!.push({
        name: file.fileName,
        type: "file",
        path: filePath,
        file,
      });
    }
  }

  // Calculate file counts recursively
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
      // Folders first, then files
      if (a.type !== b.type) {
        return a.type === "folder" ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });
}

interface TreeNodeItemProps {
  node: TreeNode;
  depth: number;
  selectedFile: FileEntry | null;
  onSelectFile: (file: FileEntry) => void;
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
    node.file.logName === selectedFile.logName &&
    node.file.fileName === selectedFile.fileName;

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
  return (
    <button
      onClick={() => node.file && onSelectFile(node.file)}
      className={cn(
        "flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-sm hover:bg-muted/70",
        isSelected && "bg-primary/10 text-primary",
      )}
      style={{ paddingLeft: `${depth * 16 + 8 + 18}px` }}
    >
      <FileIcon className={cn("h-4 w-4 shrink-0", isSelected ? "text-primary" : "text-muted-foreground")} />
      <span className="truncate">{node.name}</span>
      {node.file && (
        <span className="ml-auto shrink-0 text-xs text-muted-foreground">
          {formatFileSize(node.file.fileSize)}
        </span>
      )}
    </button>
  );
}

export function FileTree({ files, selectedFile, onSelectFile }: FileTreeProps) {
  const tree = useMemo(() => sortTree(buildTree(files)), [files]);

  // Auto-expand all top-level folders initially
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(() => {
    const paths = new Set<string>();
    for (const node of tree) {
      paths.add(node.path);
    }
    return paths;
  });

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
      <div className="py-1">
        {tree.map((node) => (
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
    </ScrollArea>
  );
}
