import React from "react";
import { Handle, Position } from "@xyflow/react";
import type { NodeProps } from "@xyflow/react";
import { cn } from "@/lib/utils";

// Define the shape of our node data
interface NodeData {
  id: string;
  label: string;
  type?: string;
  args?: any[];
  params?: any;
  kwargs?: Record<string, any>;
  originalKey?: string;
  key?: string;
  module?: string; // Added to identify the module (assumed)
}

export default function BaseNode({ id, data, selected }: NodeProps) {
  // @ts-ignore
  const nodeData = data as NodeData;
  const { label, type, args = [], kwargs = {}, originalKey, key } = nodeData;

  const isRoot = key === ".";

  return (
    <div
      className={cn(
        "relative rounded-md border-2",
        selected
          ? "border-blue-500 bg-blue-50 shadow-lg"
          : "border-gray-300 bg-white",
        "px-4 py-2",
        "shadow-sm transition-all duration-200",
        selected ? "bg-blue-200 dark:bg-blue-900" : "dark:bg-accent",
      )}
    >
      {/* Top target handle for intra-module connections */}
      <Handle
        id={`${id}-top-target`}
        type="target"
        position={Position.Top}
        className={`!top-0 h-2 w-2 -translate-y-[1px] !border-2 ${selected ? "!border-blue-500 bg-blue-500" : "!border-gray-500 bg-gray-500"}`}
      />

      {/* Left target handle for inter-module connections */}
      <Handle
        id={`${id}-left-target`}
        type="target"
        position={Position.Left}
        className={`!left-0 h-2 w-2 -translate-x-[1px] !border-2 ${selected ? "!border-blue-500 bg-blue-500" : "!border-gray-500 bg-gray-500"}`}
      />

      {/* Node content */}
      <div className="flex flex-col gap-1">
        {!isRoot && (
          <div
            className="font-mono text-xs break-words text-gray-500 dark:text-gray-400"
            style={{ maxWidth: 160 }}
          >
            {key}
          </div>
        )}

        <div className="text-sm font-medium break-words text-gray-800 dark:text-white">
          {type}
        </div>
      </div>

      {/* Right source handle for inter-module connections */}
      <Handle
        id={`${id}-right-source`}
        type="source"
        position={Position.Right}
        className={`!right-0 h-2 w-2 translate-x-[1px] !border-2 ${selected ? "!border-blue-500 bg-blue-500" : "!border-gray-500 bg-gray-500"}`}
      />

      {/* Bottom source handle for intra-module connections */}
      <Handle
        id={`${id}-bottom-source`}
        type="source"
        position={Position.Bottom}
        className={`!bottom-0 h-2 w-2 translate-y-[1px] !border-2 ${selected ? "!border-blue-500 bg-blue-500" : "!border-gray-500 bg-gray-500"}`}
      />
    </div>
  );
}
