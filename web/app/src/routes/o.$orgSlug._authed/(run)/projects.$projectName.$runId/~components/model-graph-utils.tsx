import dagre from "dagre";
import type { Node, Edge } from "@xyflow/react";

// Module metadata structure
export type ModuleDataEntry = {
  type: string;
  inst_id: string | null;
  edges: [string, string][];
  args: any[];
  kwargs: Record<string, any>;
  order?: number;
  label?: string;
  node_id?: string;
  node_type?: string;
  params?: any;
  depth?: number;
  key?: string;
};

export interface ModuleData {
  [key: string]: ModuleDataEntry;
}

/**
 * Returns the parent key (everything before the last dot) or null.
 */
function getParentKey(key: string): string | null {
  const idx = key.lastIndexOf(".");
  return idx > 0 ? key.slice(0, idx) : null;
}

/**
 * Build React Flow nodes and edges from module data (no positioning).
 */
function buildElements(data: ModuleData): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [];
  const edges: Edge[] = [];

  // Create nodes for each module
  Object.entries(data).forEach(([key, entry]) => {
    const id = entry.node_id ?? key;
    nodes.push({
      id,
      type: "baseNode",
      data: {
        label: `${entry.label ?? entry.type}\n${key}`,
        key: key,
        type: entry.type,
        args: entry.args,
        params: entry.params,
        kwargs: entry.kwargs,
        depth: entry.depth,
        category: "main",
      },
      position: { x: 0, y: 0 },
      style: { padding: 10 },
    });

    // Restored depth 1 edge block
    if (entry.depth === 1) {
      edges.push({
        id: `edge-${"."}-${id}`,
        source: ".",
        target: id,
        sourceHandle: `${"."}-bottom-source`,
        targetHandle: `${id}-top-target`,
        type: "hierarchical",
      });
    }
  });

  // Create a map from id to key for module affiliation
  const idToKey = new Map<string, string>();
  nodes.forEach((node) => idToKey.set(node.id, node.data.key as string));

  // Hierarchical edges (parent-child relationships)
  const parentMap = new Map<string, string[]>();
  Object.keys(data).forEach((key) => {
    const parent = getParentKey(key);
    if (parent) {
      parentMap.set(parent, [...(parentMap.get(parent) || []), key]);
    }
  });

  parentMap.forEach((children, parentKey) => {
    const parentId = data[parentKey]?.node_id ?? parentKey;
    children.forEach((childKey) => {
      const childId = data[childKey]?.node_id ?? childKey;
      edges.push({
        id: `hier-${parentId}-${childId}`,
        source: parentId,
        target: childId,
        sourceHandle: `${parentId}-bottom-source`,
        targetHandle: `${childId}-top-target`,
        type: "hierarchical",
        animated: false,
        style: { strokeWidth: 2 },
      });
    });
  });

  // Functional edges with corrected handle logic
  Object.values(data).forEach((entry) => {
    entry.edges.forEach(([src, dst]) => {
      const isInput = src.startsWith("in_");
      const isOutput = dst.startsWith("out_");

      if (!isInput && !isOutput) {
        const sourceKey = idToKey.get(src);
        const targetKey = idToKey.get(dst);
        if (sourceKey && targetKey) {
          const sourceParent = getParentKey(sourceKey);
          const targetParent = getParentKey(targetKey);
          const isIntraModule =
            sourceParent !== null &&
            targetParent !== null &&
            sourceParent === targetParent;

          const sourceHandle = isIntraModule
            ? `${src}-right-source`
            : `${src}-right-source`;

          const targetHandle = isIntraModule
            ? `${dst}-left-target`
            : `${dst}-left-target`;

          edges.push({
            id: `edge-${src}-${dst}`,
            source: src,
            target: dst,
            sourceHandle,
            targetHandle,
            animated: true,
            style: { strokeWidth: 2 },
          });
        }
      }
    });
  });

  return { nodes, edges };
}
/**
 * Perform automatic layout using Dagre and position nodes.
 */
function layoutNodes(
  nodes: Node[],
  edges: Edge[],
  options: {
    direction?: "TB" | "LR";
    width?: number;
    height?: number;
    ranksep?: number;
    nodesep?: number;
    marginx?: number;
    marginy?: number;
  } = {},
): Node[] {
  const {
    direction = "TB",
    width = 172,
    height = 36,
    ranksep = 100,
    nodesep = 50,
    marginx = 50,
    marginy = 50,
  } = options;

  // Step 1: Filter main nodes and hierarchical edges
  const mainNodes = nodes.filter((node) => node.data.category === "main");
  const hierEdges = edges.filter((edge) => edge.type === "hierarchical");

  // Step 2: Layout main nodes with hierarchical edges
  const graph = new dagre.graphlib.Graph();
  graph.setGraph({ rankdir: direction, ranksep, nodesep, marginx, marginy });
  graph.setDefaultEdgeLabel(() => ({}));

  mainNodes.forEach((node) => graph.setNode(node.id, { width, height }));
  hierEdges.forEach(({ source, target }) => graph.setEdge(source, target));

  dagre.layout(graph);

  // Step 3: Assign positions to main nodes
  const positionedMainNodes = mainNodes.map((node) => {
    const { x, y } = graph.node(node.id);
    return { ...node, position: { x: x - width / 2, y: y - height / 2 } };
  });

  // Step 4: Position IO nodes relative to their connected main nodes
  const ioNodes = nodes.filter((node) => node.data.category === "io");
  const positionedIoNodes = ioNodes.map((ioNode) => {
    const edge = edges.find(
      (e) => e.source === ioNode.id || e.target === ioNode.id,
    );
    if (!edge) return { ...ioNode, position: { x: 0, y: 0 } }; // Fallback

    const mainNodeId = edge.source === ioNode.id ? edge.target : edge.source;
    const mainNode = positionedMainNodes.find((n) => n.id === mainNodeId);
    if (!mainNode) return { ...ioNode, position: { x: 0, y: 0 } }; // Fallback

    const isInput = edge.target === mainNodeId;
    const offsetX = isInput ? -100 : 100; // Input left, Output right
    const pos = {
      x: mainNode.position.x + offsetX,
      y: mainNode.position.y, // Align vertically with main node
    };
    return { ...ioNode, position: pos };
  });

  // Step 5: Combine all positioned nodes
  return [...positionedMainNodes, ...positionedIoNodes];
}

/**
 * Convert module data into React Flow elements with layout applied.
 */
export function toReactFlowElements(
  moduleData: ModuleData,
  layoutOptions = {},
) {
  const { nodes, edges } = buildElements(moduleData);
  const positionedNodes = layoutNodes(nodes, edges, layoutOptions);
  return { nodes: positionedNodes, edges };
}
