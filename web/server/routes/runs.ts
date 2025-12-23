import { zValidator } from "@hono/zod-validator";
import {
  Prisma,
  RunGraphNodeType,
  RunLogType,
  RunStatus,
} from "@prisma/client";
import { Hono } from "hono";
import { z } from "zod";
import { sqidDecode, sqidEncode } from "../lib/sqid";
import { withApiKey } from "./middleware";
import { env } from "../lib/env";
import { getLogGroupName } from "../lib/utilts";
import {
  getOrgLimits,
  getDataUsageQuery,
  getFileDataUsageQuery,
} from "../trpc/routers/organization/routers/usage/procs/data-usage";
import { createContext } from "../lib/context";

const router = new Hono();

router.post(
  "/create",
  withApiKey,
  zValidator(
    "json",
    z.object({
      runName: z.string(),
      projectName: z.string(),
      tags: z.array(z.string()).optional().nullable(),
      loggerSettings: z.string().optional().nullable(),
      systemMetadata: z.string().optional().nullable(),
      config: z.string().optional().nullable(),
      createdAt: z
        .number()
        .transform((ms) => new Date(ms))
        .optional()
        .nullable(),
      updatedAt: z
        .number()
        .transform((ms) => new Date(ms))
        .optional()
        .nullable(),
    })
  ),
  async (c) => {
    const apiKey = c.get("apiKey");
    const {
      runName,
      projectName,
      tags,
      loggerSettings,
      systemMetadata,
      config,
      createdAt,
      updatedAt,
    } = c.req.valid("json");

    // Create context manually for tRPC-style functions
    const ctx = await createContext({ hono: c });
    // Check if the organization is at limit
    const [tableUsage, fileUsage, orgLimits] = await Promise.all([
      getDataUsageQuery(ctx, apiKey.organization.id),
      getFileDataUsageQuery(ctx, apiKey.organization.id),
      getOrgLimits(ctx, apiKey.organization.id),
    ]);

    const totalUsage =
      tableUsage.reduce((acc, curr) => acc + curr.estimated_size_gb, 0) +
      fileUsage;

    if (totalUsage > orgLimits.dataUsageGB) {
      return c.json({ error: "Organization is at limit" }, 400);
    }

    // Find or create project in the organization
    const project = await ctx.prisma.projects.upsert({
      where: {
        organizationId_name: {
          organizationId: apiKey.organization.id,
          name: projectName,
        },
      },
      update: {},
      create: {
        name: projectName,
        organizationId: apiKey.organization.id,
        createdAt: createdAt || new Date(),
        updatedAt: updatedAt || new Date(),
      },
    });

    try {
      // Parse JSON metadata if provided
      const parsedLoggerSettings =
        loggerSettings && loggerSettings !== "null"
          ? JSON.parse(loggerSettings)
          : Prisma.DbNull;
      const parsedSystemMetadata =
        systemMetadata && systemMetadata !== "null"
          ? JSON.parse(systemMetadata)
          : Prisma.DbNull;
      const parsedConfig =
        config && config !== "null" ? JSON.parse(config) : Prisma.DbNull;

      // Create the run
      const run = await ctx.prisma.runs.create({
        data: {
          name: runName,
          projectId: project.id,
          organizationId: apiKey.organization.id,
          tags: tags || [],
          status: RunStatus.RUNNING,
          loggerSettings: parsedLoggerSettings,
          systemMetadata: parsedSystemMetadata,
          config: parsedConfig,
          createdById: apiKey.user.id,
          creatorApiKeyId: apiKey.id,
        },
      });

      const encodedRunId = sqidEncode(run.id);
      const runUrl = `${env.BETTER_AUTH_URL}/o/${apiKey.organization.slug}/projects/${project.name}/${encodedRunId}`;

      return c.json({
        runId: Number(run.id),
        projectName: project.name,
        organizationSlug: apiKey.organization.slug,
        url: runUrl,
      });
    } catch (error) {
      console.error("Failed to create run:", error);
      return c.json({ error: "Failed to create run" }, 500);
    }
  }
);

router.post(
  "/status/update",
  withApiKey,
  zValidator(
    "json",
    z.object({
      runId: z.number(),
      status: z.nativeEnum(RunStatus),
      statusMetadata: z.string().optional().nullable(),
      loggerSettings: z.string().optional().nullable(),
    })
  ),
  async (c) => {
    const apiKey = c.get("apiKey");
    const { runId, status, statusMetadata, loggerSettings } =
      c.req.valid("json");

    const run = await c.get("prisma").runs.findUnique({
      where: {
        id: runId,
        organizationId: apiKey.organization.id,
      },
    });

    if (!run) {
      return c.json({ error: "Run not found" }, 404);
    }

    // update logger settings from existing
    let updatedLoggerSettings = (run.loggerSettings || {}) as Record<
      string,
      any
    >;
    if (loggerSettings && loggerSettings !== "null") {
      const newLoggerSettings = JSON.parse(loggerSettings) as Record<
        string,
        any
      >;
      updatedLoggerSettings = {
        ...updatedLoggerSettings,
        ...newLoggerSettings,
      };
    }

    await c.get("prisma").runs.update({
      where: { id: runId, organizationId: apiKey.organization.id },
      data: {
        status,
        statusUpdated: new Date(),
        statusMetadata: statusMetadata
          ? JSON.parse(statusMetadata)
          : Prisma.DbNull,
        loggerSettings:
          Object.keys(updatedLoggerSettings).length > 0
            ? updatedLoggerSettings
            : Prisma.DbNull,
      },
    });

    return c.json({ success: true });
  }
);

router.post(
  "/logName/add",
  withApiKey,
  zValidator(
    "json",
    z.object({
      runId: z.number(),
      logName: z.array(z.string()),
      logType: z.nativeEnum(RunLogType),
    })
  ),
  async (c) => {
    const apiKey = c.get("apiKey");
    const { runId, logName, logType } = c.req.valid("json");

    const run = await c.get("prisma").runs.findUnique({
      include: {
        logs: true,
      },
      where: {
        id: runId,
        organizationId: apiKey.organization.id,
      },
    });

    if (!run) {
      return c.json({ error: "Run not found" }, 404);
    }

    const existingLogNames = run.logs.map((log) => log.logName);
    const logNamesToAdd = logName.filter(
      (name) => !existingLogNames.includes(name)
    );

    await c.get("prisma").runLogs.createMany({
      data: logNamesToAdd.map((name) => ({
        logName: name,
        runId: runId,
        logType: logType,
        logGroup: getLogGroupName(name),
      })),
    });

    return c.json({ success: true });
  }
);

router.get("/:runId", async (c) => {
  const { runId } = c.req.param();
  const decodedRunId = sqidDecode(runId);
  return c.json({
    runId: decodedRunId,
  });
});

export const modelGraphNode = z.object({
  type: z.string(),
  depth: z.number().int(),
  order: z.number().int().optional(),
  label: z.string().optional(),
  node_id: z.string().optional(),
  node_type: z.nativeEnum(RunGraphNodeType).optional(),
  inst_id: z.string().optional(),
  args: z.array(z.any()).optional(),
  kwargs: z.record(z.any()).optional(),
  params: z.record(z.array(z.number())).optional(),
  edges: z.array(z.array(z.string())).optional(),
});

export const modelGraphData = z.object({
  format: z.string(),
  nodes: z.record(z.string(), modelGraphNode),
});

router.post(
  "/modelGraph/create",
  withApiKey,
  zValidator(
    "json",
    z.object({
      runId: z.number(),
      graph: modelGraphData,
    })
  ),
  async (c) => {
    const apiKey = c.get("apiKey");
    const { runId, graph } = c.req.valid("json");

    const run = await c.get("prisma").runs.findUnique({
      where: { id: runId, organizationId: apiKey.organization.id },
    });

    if (!run) {
      return c.json({ error: "Run not found" }, 404);
    }

    for (const [name, node] of Object.entries(graph.nodes)) {
      await c.get("prisma").runGraphNode.create({
        data: {
          runId,
          name,
          type: node.type,
          order: node.order,
          depth: node.depth,
          label: node.label,
          nodeId: node.node_id,
          nodeType: node.node_type,
          instId: node.inst_id,
          args: node.args,
          kwargs: node.kwargs,
          params: node.params,
        },
      });

      if (node.edges) {
        for (const [sourceId, targetId] of node.edges) {
          await c.get("prisma").runGraphEdge.create({
            data: {
              runId,
              sourceId,
              targetId,
            },
          });
        }
      }
    }

    return c.json({ success: true });
  }
);

export default router;
