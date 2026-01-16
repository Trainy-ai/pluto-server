import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import {
  Prisma,
  RunGraphNodeType,
  RunLogType,
  RunStatus,
} from "@prisma/client";
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
import type { prisma } from "../lib/prisma";
import type { ApiKey, Organization, User } from "@prisma/client";

// Type for API key with relations
type ApiKeyWithRelations = ApiKey & {
  organization: Pick<Organization, "id" | "slug">;
  user: Pick<User, "id">;
};

// Extend Hono context types
type Env = {
  Variables: {
    prisma: typeof prisma;
    apiKey: ApiKeyWithRelations;
  };
};

const router = new OpenAPIHono<Env>();

// Common response schemas
const ErrorSchema = z.object({
  error: z.string(),
}).openapi("Error");

const SuccessSchema = z.object({
  success: z.boolean(),
}).openapi("Success");

// ============= Create Run =============
const createRunRoute = createRoute({
  method: "post",
  path: "/create",
  tags: ["Runs"],
  summary: "Create a new run",
  description: "Creates a new run in the specified project. If the project doesn't exist, it will be created. If externalId is provided and a run with that ID already exists, the existing run is returned (Neptune-style resume for multi-node distributed training).",
  security: [{ bearerAuth: [] }],
  request: {
    body: {
      content: {
        "application/json": {
          schema: z.object({
            runName: z.string().openapi({ description: "Name of the run", example: "training-run-1" }),
            projectName: z.string().openapi({ description: "Name of the project", example: "my-project" }),
            externalId: z.string().min(1).optional().nullable().openapi({ description: "User-provided run ID for multi-node distributed training. If provided and a run with this ID exists, the existing run is returned.", example: "my-ddp-run-2024" }),
            tags: z.array(z.string()).optional().nullable().openapi({ description: "Tags for the run", example: ["experiment", "v1"] }),
            loggerSettings: z.string().optional().nullable().openapi({ description: "Logger settings as JSON string" }),
            systemMetadata: z.string().optional().nullable().openapi({ description: "System metadata as JSON string" }),
            config: z.string().optional().nullable().openapi({ description: "Run configuration as JSON string", example: '{"lr": 0.001}' }),
            createdAt: z.number().optional().nullable().openapi({ description: "Creation timestamp in milliseconds" }),
            updatedAt: z.number().optional().nullable().openapi({ description: "Update timestamp in milliseconds" }),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: "Run created successfully",
      content: {
        "application/json": {
          schema: z.object({
            runId: z.number().openapi({ description: "Numeric ID of the created run" }),
            projectName: z.string().openapi({ description: "Name of the project" }),
            organizationSlug: z.string().openapi({ description: "Organization slug" }),
            url: z.string().openapi({ description: "URL to view the run" }),
            resumed: z.boolean().openapi({ description: "Whether an existing run was resumed (true) or a new run was created (false)" }),
          }).openapi("CreateRunResponse"),
        },
      },
    },
    400: {
      description: "Organization is at limit",
      content: { "application/json": { schema: ErrorSchema } },
    },
    401: {
      description: "Unauthorized",
      content: { "application/json": { schema: ErrorSchema } },
    },
    500: {
      description: "Internal server error",
      content: { "application/json": { schema: ErrorSchema } },
    },
  },
});

router.use(createRunRoute.path, withApiKey);
router.openapi(createRunRoute, async (c) => {
  const apiKey = c.get("apiKey");
  const { runName, projectName, externalId, tags, loggerSettings, systemMetadata, config, createdAt, updatedAt } = c.req.valid("json");

  const ctx = await createContext({ hono: c });

  // Upsert project first (needed for both new and resumed runs)
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
      createdAt: createdAt ? new Date(createdAt) : new Date(),
      updatedAt: updatedAt ? new Date(updatedAt) : new Date(),
    },
  });

  let run: { id: bigint } | null = null;
  let resumed = false;

  // If externalId is provided, check if a run with this ID already exists (Neptune-style resume)
  if (externalId) {
    const existingRun = await ctx.prisma.runs.findFirst({
      where: {
        externalId,
        organizationId: apiKey.organization.id,
        projectId: project.id,
      },
    });

    if (existingRun) {
      run = existingRun;
      resumed = true;
    }
  }

  // Create new run if not resuming
  if (!run) {
    // Check usage limits only when creating a new run
    const [tableUsage, fileUsage, orgLimits] = await Promise.all([
      getDataUsageQuery(ctx, apiKey.organization.id),
      getFileDataUsageQuery(ctx, apiKey.organization.id),
      getOrgLimits(ctx, apiKey.organization.id),
    ]);

    const totalUsage = tableUsage.reduce((acc, curr) => acc + curr.estimated_size_gb, 0) + fileUsage;

    if (totalUsage > orgLimits.dataUsageGB) {
      return c.json({ error: "Organization is at limit" }, 400);
    }

    try {
      const parsedLoggerSettings = loggerSettings && loggerSettings !== "null" ? JSON.parse(loggerSettings) : Prisma.DbNull;
      const parsedSystemMetadata = systemMetadata && systemMetadata !== "null" ? JSON.parse(systemMetadata) : Prisma.DbNull;
      const parsedConfig = config && config !== "null" ? JSON.parse(config) : Prisma.DbNull;

      run = await ctx.prisma.runs.create({
        data: {
          name: runName,
          externalId: externalId || null,
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
    } catch (error) {
      if (error instanceof SyntaxError) {
        return c.json({ error: "Invalid JSON format in request body" }, 400);
      }
      console.error("Failed to create run:", error);
      return c.json({ error: "Failed to create run" }, 500);
    }
  }

  const encodedRunId = sqidEncode(run.id);
  const runUrl = `${env.BETTER_AUTH_URL}/o/${apiKey.organization.slug}/projects/${project.name}/${encodedRunId}`;

  return c.json({
    runId: Number(run.id),
    projectName: project.name,
    organizationSlug: apiKey.organization.slug,
    url: runUrl,
    resumed,
  }, 200);
});

// ============= Update Status =============
const updateStatusRoute = createRoute({
  method: "post",
  path: "/status/update",
  tags: ["Runs"],
  summary: "Update run status",
  description: "Updates the status of an existing run (e.g., RUNNING, COMPLETED, FAILED).",
  security: [{ bearerAuth: [] }],
  request: {
    body: {
      content: {
        "application/json": {
          schema: z.object({
            runId: z.number().openapi({ description: "Numeric ID of the run", example: 123 }),
            status: z.nativeEnum(RunStatus).openapi({ description: "New status", example: "COMPLETED" }),
            statusMetadata: z.string().optional().nullable().openapi({ description: "Status metadata as JSON string" }),
            loggerSettings: z.string().optional().nullable().openapi({ description: "Logger settings to merge" }),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: "Status updated successfully",
      content: { "application/json": { schema: SuccessSchema } },
    },
    400: {
      description: "Invalid JSON in request",
      content: { "application/json": { schema: ErrorSchema } },
    },
    404: {
      description: "Run not found",
      content: { "application/json": { schema: ErrorSchema } },
    },
  },
});

router.use(updateStatusRoute.path, withApiKey);
router.openapi(updateStatusRoute, async (c) => {
  const apiKey = c.get("apiKey");
  const { runId, status, statusMetadata, loggerSettings } = c.req.valid("json");

  const run = await c.get("prisma").runs.findUnique({
    where: { id: runId, organizationId: apiKey.organization.id },
  });

  if (!run) {
    return c.json({ error: "Run not found" }, 404);
  }

  let updatedLoggerSettings = (run.loggerSettings || {}) as Record<string, any>;
  if (loggerSettings && loggerSettings !== "null") {
    try {
      const newLoggerSettings = JSON.parse(loggerSettings) as Record<string, any>;
      updatedLoggerSettings = { ...updatedLoggerSettings, ...newLoggerSettings };
    } catch (error) {
      return c.json({ error: "Invalid loggerSettings JSON" }, 400);
    }
  }

  let parsedStatusMetadata = Prisma.DbNull as any;
  if (statusMetadata) {
    try {
      parsedStatusMetadata = JSON.parse(statusMetadata);
    } catch (error) {
      return c.json({ error: "Invalid statusMetadata JSON" }, 400);
    }
  }

  await c.get("prisma").runs.update({
    where: { id: runId, organizationId: apiKey.organization.id },
    data: {
      status,
      statusUpdated: new Date(),
      statusMetadata: parsedStatusMetadata,
      loggerSettings: Object.keys(updatedLoggerSettings).length > 0 ? updatedLoggerSettings : Prisma.DbNull,
    },
  });

  return c.json({ success: true }, 200);
});

// ============= Add Log Names =============
const addLogNameRoute = createRoute({
  method: "post",
  path: "/logName/add",
  tags: ["Runs"],
  summary: "Add log names to a run",
  description: "Adds new log names (metrics, console logs, etc.) to an existing run.",
  security: [{ bearerAuth: [] }],
  request: {
    body: {
      content: {
        "application/json": {
          schema: z.object({
            runId: z.number().openapi({ description: "Numeric ID of the run" }),
            logName: z.array(z.string()).openapi({ description: "Log names to add", example: ["train/loss", "train/accuracy"] }),
            logType: z.nativeEnum(RunLogType).openapi({ description: "Type of log", example: "METRIC" }),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: "Log names added successfully",
      content: { "application/json": { schema: SuccessSchema } },
    },
    404: {
      description: "Run not found",
      content: { "application/json": { schema: ErrorSchema } },
    },
  },
});

router.use(addLogNameRoute.path, withApiKey);
router.openapi(addLogNameRoute, async (c) => {
  const apiKey = c.get("apiKey");
  const { runId, logName, logType } = c.req.valid("json");

  const run = await c.get("prisma").runs.findUnique({
    include: { logs: true },
    where: { id: runId, organizationId: apiKey.organization.id },
  });

  if (!run) {
    return c.json({ error: "Run not found" }, 404);
  }

  const existingLogNames = run.logs.map((log) => log.logName);
  const logNamesToAdd = logName.filter((name) => !existingLogNames.includes(name));

  await c.get("prisma").runLogs.createMany({
    data: logNamesToAdd.map((name) => ({
      logName: name,
      runId: runId,
      logType: logType,
      logGroup: getLogGroupName(name),
    })),
  });

  return c.json({ success: true }, 200);
});

// ============= Update Tags =============
const updateTagsRoute = createRoute({
  method: "post",
  path: "/tags/update",
  tags: ["Runs"],
  summary: "Update run tags",
  description: "Replaces all tags on a run with the provided tags.",
  security: [{ bearerAuth: [] }],
  request: {
    body: {
      content: {
        "application/json": {
          schema: z.object({
            runId: z.number().openapi({ description: "Numeric ID of the run" }),
            tags: z.array(z.string()).openapi({ description: "New tags for the run", example: ["production", "v2"] }),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: "Tags updated successfully",
      content: { "application/json": { schema: SuccessSchema } },
    },
    404: {
      description: "Run not found",
      content: { "application/json": { schema: ErrorSchema } },
    },
  },
});

router.use(updateTagsRoute.path, withApiKey);
router.openapi(updateTagsRoute, async (c) => {
  const apiKey = c.get("apiKey");
  const { runId, tags } = c.req.valid("json");

  const result = await c.get("prisma").runs.updateMany({
    where: { id: runId, organizationId: apiKey.organization.id },
    data: { tags },
  });

  if (result.count === 0) {
    return c.json({ error: "Run not found" }, 404);
  }

  return c.json({ success: true }, 200);
});

// ============= Update Config =============
const updateConfigRoute = createRoute({
  method: "post",
  path: "/config/update",
  tags: ["Runs"],
  summary: "Update run config",
  description: "Merges new configuration with existing run config. New keys override existing keys.",
  security: [{ bearerAuth: [] }],
  request: {
    body: {
      content: {
        "application/json": {
          schema: z.object({
            runId: z.number().openapi({ description: "Numeric ID of the run" }),
            config: z.string().openapi({ description: "Configuration as JSON string", example: '{"model": "resnet50"}' }),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: "Config updated successfully",
      content: { "application/json": { schema: SuccessSchema } },
    },
    400: {
      description: "Invalid config JSON",
      content: { "application/json": { schema: ErrorSchema } },
    },
    404: {
      description: "Run not found",
      content: { "application/json": { schema: ErrorSchema } },
    },
  },
});

router.use(updateConfigRoute.path, withApiKey);
router.openapi(updateConfigRoute, async (c) => {
  const apiKey = c.get("apiKey");
  const { runId, config } = c.req.valid("json");

  const run = await c.get("prisma").runs.findUnique({
    where: { id: runId, organizationId: apiKey.organization.id },
  });

  if (!run) {
    return c.json({ error: "Run not found" }, 404);
  }

  let updatedConfig = (run.config || {}) as Record<string, any>;
  if (config && config !== "null") {
    try {
      const newConfig = JSON.parse(config) as Record<string, any>;
      updatedConfig = { ...updatedConfig, ...newConfig };
    } catch (error) {
      return c.json({ error: "Invalid config JSON" }, 400);
    }
  }

  await c.get("prisma").runs.update({
    where: { id: runId, organizationId: apiKey.organization.id },
    data: {
      config: Object.keys(updatedConfig).length > 0 ? updatedConfig : Prisma.DbNull,
    },
  });

  return c.json({ success: true }, 200);
});

// ============= Get Run by ID =============
const getRunRoute = createRoute({
  method: "get",
  path: "/{runId}",
  tags: ["Runs"],
  summary: "Get run by ID",
  description: "Decodes a SQID-encoded run ID and returns the numeric ID.",
  request: {
    params: z.object({
      runId: z.string().openapi({ description: "SQID-encoded run ID" }),
    }),
  },
  responses: {
    200: {
      description: "Run ID decoded successfully",
      content: {
        "application/json": {
          schema: z.object({
            runId: z.number().openapi({ description: "Numeric run ID" }),
          }),
        },
      },
    },
  },
});

router.openapi(getRunRoute, async (c) => {
  const { runId } = c.req.valid("param");
  const decodedRunId = sqidDecode(runId);
  return c.json({ runId: decodedRunId }, 200);
});

// ============= Model Graph Schemas =============
const modelGraphNodeSchema = z.object({
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

const modelGraphDataSchema = z.object({
  format: z.string(),
  nodes: z.record(z.string(), modelGraphNodeSchema),
});

// ============= Create Model Graph =============
const createModelGraphRoute = createRoute({
  method: "post",
  path: "/modelGraph/create",
  tags: ["Runs"],
  summary: "Create model graph",
  description: "Creates a model graph visualization for a run, including nodes and edges.",
  security: [{ bearerAuth: [] }],
  request: {
    body: {
      content: {
        "application/json": {
          schema: z.object({
            runId: z.number().openapi({ description: "Numeric ID of the run" }),
            graph: modelGraphDataSchema.openapi({ description: "Graph data with nodes and edges" }),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: "Model graph created successfully",
      content: { "application/json": { schema: SuccessSchema } },
    },
    404: {
      description: "Run not found",
      content: { "application/json": { schema: ErrorSchema } },
    },
  },
});

router.use(createModelGraphRoute.path, withApiKey);
router.openapi(createModelGraphRoute, async (c) => {
  const apiKey = c.get("apiKey");
  const { runId, graph } = c.req.valid("json");

  const run = await c.get("prisma").runs.findUnique({
    where: { id: runId, organizationId: apiKey.organization.id },
  });

  if (!run) {
    return c.json({ error: "Run not found" }, 404);
  }

  // Collect all nodes and edges for bulk insert
  const nodesToCreate: Array<{
    runId: typeof runId;
    name: string;
    type: string;
    order?: number;
    depth: number;
    label?: string;
    nodeId?: string;
    nodeType?: RunGraphNodeType;
    instId?: string;
    args?: any[];
    kwargs?: Record<string, any>;
    params?: Record<string, number[]>;
  }> = [];
  const edgesToCreate: Array<{
    runId: typeof runId;
    sourceId: string;
    targetId: string;
  }> = [];

  for (const [name, node] of Object.entries(graph.nodes)) {
    nodesToCreate.push({
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
    });

    if (node.edges) {
      for (const [sourceId, targetId] of node.edges) {
        edgesToCreate.push({ runId, sourceId, targetId });
      }
    }
  }

  // Bulk insert using transaction
  await c.get("prisma").$transaction([
    c.get("prisma").runGraphNode.createMany({ data: nodesToCreate }),
    c.get("prisma").runGraphEdge.createMany({ data: edgesToCreate }),
  ]);

  return c.json({ success: true }, 200);
});

export default router;
