import React, { useState, useMemo, useCallback } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  Panel,
  MiniMap,
  ReactFlowProvider,
  MarkerType,
  useReactFlow,
} from "@xyflow/react";
import type { Node, Edge } from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { trpc } from "@/utils/trpc";
import { useQuery } from "@tanstack/react-query";
import { toReactFlowElements, type ModuleDataEntry } from "./model-graph-utils";
import BaseNode from "./nodes/base-node";
import { HistogramView } from "./group/histogram-view";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

// Define node types
const nodeTypes = {
  baseNode: BaseNode,
};

// Define default edge options
const defaultEdgeOptions = {
  // type: "smoothstep",
  markerEnd: {
    type: MarkerType.ArrowClosed,
  },
  style: {
    strokeWidth: 2,
  },
  // Prevent edge overlapping by adding curve settings
  pathOptions: {
    offset: 0, // Add spacing between parallel edges
    borderRadius: 20, // Smoothser curves
  },
};

interface NodeDialogProps {
  node: Node | null;
  position: { x: number; y: number } | null;
  onClose: () => void;
  projectName: string;
  orgId: string;
  runId: string;
}

function NodeDialog({
  node,
  position,
  onClose,
  projectName,
  orgId,
  runId,
}: NodeDialogProps): React.ReactElement | null {
  if (!node || !position) return null;

  const data = node.data as ModuleDataEntry;
  const codeStr = `${data.type}(${data.args?.length ? data.args.map((arg) => arg).join(", ") : ""}${
    data.kwargs && Object.keys(data.kwargs).length
      ? `${data.args?.length ? ", " : ""}${Object.entries(data.kwargs)
          .map(([k, v]) => `${k}=${v}`)
          .join(", ")}`
      : ""
  })`;

  // Format the code string in Python style
  const formattedCode =
    codeStr.length > 60
      ? `${data.type}(\n    ${[
          ...(data.args?.length ? data.args : []),
          ...(data.kwargs
            ? Object.entries(data.kwargs).map(([k, v]) => `${k}=${v}`)
            : []),
        ].join(",\n    ")}\n)`
      : codeStr;

  const params = Object.keys(data.params || {}).map(
    (key) => data.key + "." + key,
  );

  const hasHistograms = params.length > 0;
  const paramPrefixes = ["param/", "grad/"];

  return (
    <div
      className="absolute z-10 flex w-[800px] flex-col rounded-lg border bg-white shadow-lg dark:border-gray-700 dark:bg-accent"
      style={{
        left: "0px",
        top: "0px",
        maxHeight: "calc(100vh - 200px)",
      }}
    >
      <div className="flex-none border-b bg-white p-4 dark:border-gray-700 dark:bg-accent">
        <div className="flex items-center justify-between">
          <h3 className="font-mono text-lg font-semibold text-gray-900 dark:text-white">
            {data.type}
            <span className="font-mono text-gray-500">
              {data.key ? ` (${data.key})` : ""}
            </span>
          </h3>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
          >
            ×
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto">
        <div className="p-4">
          {hasHistograms && (
            <div className="grid grid-cols-2 gap-4">
              {params.map((param) =>
                paramPrefixes.map((prefix) => (
                  <Card key={`${prefix}${param}`} className="p-2">
                    <HistogramView
                      logName={prefix + param}
                      tenantId={orgId}
                      projectName={projectName}
                      runId={runId}
                    />
                  </Card>
                )),
              )}
            </div>
          )}
          {hasHistograms && <Separator className="my-4" />}
          <div className="mb-4">
            <pre className="text-sm whitespace-pre text-gray-600 dark:text-gray-300">
              {formattedCode}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
}

interface GraphFlowProps {
  runId: string;
  orgId: string;
  projectName: string;
}

export default function GraphFlow({
  runId,
  orgId,
  projectName,
}: GraphFlowProps) {
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [dialogPosition, setDialogPosition] = useState<{
    x: number;
    y: number;
  } | null>(null);

  const {
    data: moduleJson,
    isLoading,
    isError,
    error,
  } = useQuery(
    trpc.runs.data.modelGraph.queryOptions({ organizationId: orgId, runId }),
  );

  const { nodes: baseNodes, edges } = useMemo(() => {
    if (!moduleJson) {
      return { nodes: [], edges: [] };
    }
    return toReactFlowElements(moduleJson);
  }, [moduleJson]);

  const nodes = useMemo(() => {
    return baseNodes.map((node) => ({
      ...node,
      selected: node.id === selectedNodeId,
    }));
  }, [baseNodes, selectedNodeId]);

  const onNodeClick = useCallback(
    (event: React.MouseEvent, node: Node) => {
      setDialogPosition({ x: 0, y: 0 });
      setSelectedNodeId(node.id === selectedNodeId ? null : node.id);
    },
    [selectedNodeId],
  );

  const onSelectionChange = useCallback(() => {
    // Do nothing - we handle selection in onNodeClick
  }, []);

  const onPaneClick = useCallback(() => {
    setSelectedNodeId(null);
    setDialogPosition(null);
  }, []);

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        Loading model graph...
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex h-full flex-col items-center justify-center p-4 text-red-500">
        <div className="font-semibold">Error loading graph</div>
        <div className="mt-2 text-sm">{error?.message || "Unknown error"}</div>
      </div>
    );
  }

  const selectedNode = nodes.find((node) => node.id === selectedNodeId) || null;

  return (
    <div className="relative h-full">
      <ReactFlowProvider>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          defaultEdgeOptions={defaultEdgeOptions}
          onNodeClick={onNodeClick}
          onSelectionChange={onSelectionChange}
          onPaneClick={onPaneClick}
          selectNodesOnDrag={false}
          multiSelectionKeyCode={null}
          selectionKeyCode={null}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          minZoom={0.1}
          maxZoom={4}
          attributionPosition="bottom-right"
          className="bg-gray-50 dark:bg-gray-900"
        >
          <Background gap={12} size={1} color="#aaa" />

          <NodeDialog
            node={selectedNode}
            position={dialogPosition}
            onClose={() => {
              setSelectedNodeId(null);
              setDialogPosition(null);
            }}
            projectName={projectName}
            orgId={orgId}
            runId={runId}
          />
        </ReactFlow>
        <MiniMap maskColor="rgb(0,0,0, 0.3)" pannable zoomable />
      </ReactFlowProvider>
    </div>
  );
}
