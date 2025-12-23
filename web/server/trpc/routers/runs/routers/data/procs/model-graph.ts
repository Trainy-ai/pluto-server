import { protectedOrgProcedure } from "../../../../../../lib/trpc";
import { z } from "zod";
import { sqidDecode } from "../../../../../../lib/sqid";

interface NodeJson {
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
  depth: number;
}
type GraphJson = Record<string, NodeJson>;

export const modelGraphProcedure = protectedOrgProcedure
  .input(
    z.object({
      runId: z.string(),
    })
  )
  .query(async ({ ctx, input }) => {
    const { runId: encodedRunId, organizationId } = input;

    const runId = sqidDecode(encodedRunId);

    // check if they own the run
    const run = await ctx.prisma.runs.findUnique({
      where: { id: runId, organizationId },
    });

    if (!run) {
      throw new Error("Run not found");
    }

    const [nodes, edges] = await Promise.all([
      ctx.prisma.runGraphNode.findMany({ where: { runId } }),
      ctx.prisma.runGraphEdge.findMany({ where: { runId } }),
    ]);

    // 2) initialize JSON for each node
    const graph: GraphJson = {};
    for (const node of nodes) {
      graph[node.name] = {
        type: node.type,
        inst_id: node.instId,
        edges: [],
        depth: node.depth,
        args: Array.isArray(node.args) ? node.args : [],
        kwargs: node.kwargs ?? ({} as any),
        // only add optional fields if they’re set
        ...(node.order != null && { order: node.order }),
        ...(node.label && { label: node.label }),
        ...(node.nodeId && { node_id: node.nodeId }),
        ...(node.nodeType && { node_type: node.nodeType }),
        ...(node.params && { params: node.params }),
      };
    }

    // 3) build a map from nodeId → node.name for quick lookup
    const idToName = new Map<string, string>();
    for (const n of nodes) {
      if (n.nodeId) idToName.set(n.nodeId, n.name);
    }

    // 4) wire up edges
    for (const { sourceId, targetId } of edges) {
      const sourceName = idToName.get(sourceId);
      if (sourceName) {
        graph[sourceName].edges.push([sourceId, targetId]);
      }
    }

    // if empty json return null
    if (Object.keys(graph).length === 0) {
      return null;
    }

    return graph;
  });
