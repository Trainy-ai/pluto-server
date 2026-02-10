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
import { searchRunIds } from "../lib/run-search";
import { clickhouse } from "../lib/clickhouse";
import {
  queryRunLogs,
  queryRunMetrics,
  queryRunFiles,
  queryRunDetails,
  queryAllProjects,
} from "../lib/queries";
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

      // Handle race condition: another process created the run with same externalId first
      // This can happen in multi-node distributed training when multiple processes
      // call init() simultaneously with the same run_id
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002" &&
        externalId
      ) {
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

      if (!run) {
        console.error("Failed to create run:", error);
        return c.json({ error: "Failed to create run" }, 500);
      }
    }
  }

  const encodedRunId = sqidEncode(run.id);
  const runUrl = `${env.BETTER_AUTH_URL}/o/${apiKey.organization.slug}/projects/${encodeURIComponent(project.name)}/${encodedRunId}`;

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

  // First verify the run exists and belongs to this organization
  const run = await c.get("prisma").runs.findUnique({
    select: { id: true },
    where: { id: runId, organizationId: apiKey.organization.id },
  });

  if (!run) {
    return c.json({ error: "Run not found" }, 404);
  }

  // Query only the log names we're checking (not ALL logs for the run)
  // This prevents loading thousands of log records into memory
  const existingLogs = await c.get("prisma").runLogs.findMany({
    select: { logName: true },
    where: {
      runId: runId,
      logName: { in: logName },
    },
  });

  const existingLogNames = new Set(existingLogs.map((log) => log.logName));
  const logNamesToAdd = logName.filter((name) => !existingLogNames.has(name));

  if (logNamesToAdd.length > 0) {
    await c.get("prisma").runLogs.createMany({
      data: logNamesToAdd.map((name) => ({
        logName: name,
        runId: runId,
        logType: logType,
        logGroup: getLogGroupName(name),
      })),
      skipDuplicates: true, // Handle race conditions from concurrent requests
    });
  }

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

// ============= List Runs with Search =============
const listRunsRoute = createRoute({
  method: "get",
  path: "/list",
  tags: ["Runs"],
  summary: "List runs with optional search and tag filtering",
  description: "Lists runs in a project with optional search using ILIKE substring matching. Supports tag filtering with OR logic (returns runs with ANY of the specified tags).",
  security: [{ bearerAuth: [] }],
  request: {
    query: z.object({
      projectName: z.string().openapi({ description: "Project name", example: "my-project" }),
      search: z.string().optional().openapi({ description: "Search term for run names (substring match)", example: "training" }),
      tags: z.string().optional().openapi({ description: "Comma-separated list of tags to filter by (OR logic)", example: "baseline,experiment" }),
      limit: z.coerce.number().min(1).max(200).default(50).openapi({ description: "Maximum number of runs to return", example: 50 }),
    }),
  },
  responses: {
    200: {
      description: "List of runs",
      content: {
        "application/json": {
          schema: z.object({
            runs: z.array(z.object({
              id: z.number().openapi({ description: "Numeric run ID" }),
              name: z.string().openapi({ description: "Run name" }),
              status: z.string().openapi({ description: "Run status" }),
              tags: z.array(z.string()).openapi({ description: "Run tags" }),
              createdAt: z.string().openapi({ description: "Creation timestamp" }),
            })).openapi("RunListItem"),
            total: z.number().openapi({ description: "Total count of matching runs" }),
          }).openapi("ListRunsResponse"),
        },
      },
    },
    401: {
      description: "Unauthorized",
      content: { "application/json": { schema: ErrorSchema } },
    },
  },
});

router.use(listRunsRoute.path, withApiKey);
router.openapi(listRunsRoute, async (c) => {
  const apiKey = c.get("apiKey");
  const { projectName, search, tags: tagsParam, limit } = c.req.valid("query");
  const prisma = c.get("prisma");

  // Parse tags from comma-separated string
  const tags = tagsParam ? tagsParam.split(",").map((t) => t.trim()).filter(Boolean) : [];

  // Get the project
  const project = await prisma.projects.findFirst({
    where: {
      name: projectName,
      organizationId: apiKey.organization.id,
    },
    select: { id: true },
  });

  if (!project) {
    return c.json({ runs: [], total: 0 }, 200);
  }

  // If search is provided, get matching run IDs via search
  let searchMatchIds: bigint[] | undefined;
  if (search && search.trim()) {
    const matchIds = await searchRunIds(prisma, {
      organizationId: apiKey.organization.id,
      projectId: project.id,
      search: search.trim(),
    });

    if (matchIds.length === 0) {
      return c.json({ runs: [], total: 0 }, 200);
    }

    searchMatchIds = matchIds;
  }

  // Build where clause with optional tag filtering
  const whereClause = {
    projectId: project.id,
    organizationId: apiKey.organization.id,
    ...(searchMatchIds ? { id: { in: searchMatchIds } } : {}),
    ...(tags.length > 0 ? { tags: { hasSome: tags } } : {}),
  };

  // Get total count
  const total = await prisma.runs.count({ where: whereClause });

  // Fetch runs
  const runs = await prisma.runs.findMany({
    where: whereClause,
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      name: true,
      status: true,
      tags: true,
      createdAt: true,
    },
  });

  return c.json({
    runs: runs.map((run) => ({
      id: Number(run.id),
      name: run.name,
      status: run.status,
      tags: run.tags,
      createdAt: run.createdAt.toISOString(),
    })),
    total,
  }, 200);
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

// ============= MCP API Endpoints =============

// ============= Validate API Key =============
const validateApiKeyRoute = createRoute({
  method: "get",
  path: "/auth/validate",
  tags: ["Auth"],
  summary: "Validate API key",
  description: "Validates the API key and returns organization information. Used by MCP clients to verify credentials.",
  security: [{ bearerAuth: [] }],
  responses: {
    200: {
      description: "API key is valid",
      content: {
        "application/json": {
          schema: z.object({
            valid: z.boolean(),
            organization: z.object({
              id: z.string(),
              slug: z.string(),
            }),
            user: z.object({
              id: z.string(),
            }),
          }).openapi("ValidateApiKeyResponse"),
        },
      },
    },
    401: {
      description: "Invalid API key",
      content: { "application/json": { schema: ErrorSchema } },
    },
  },
});

router.use(validateApiKeyRoute.path, withApiKey);
router.openapi(validateApiKeyRoute, async (c) => {
  const apiKey = c.get("apiKey");
  return c.json({
    valid: true,
    organization: {
      id: apiKey.organization.id,
      slug: apiKey.organization.slug,
    },
    user: {
      id: apiKey.user.id,
    },
  }, 200);
});

// ============= Get Run Details =============
const getRunDetailsRoute = createRoute({
  method: "get",
  path: "/details/{runId}",
  tags: ["Runs"],
  summary: "Get full run details",
  description: "Returns complete run information including config, metadata, tags, status, and available log names.",
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({
      runId: z.coerce.number().openapi({ description: "Numeric run ID" }),
    }),
  },
  responses: {
    200: {
      description: "Run details",
      content: {
        "application/json": {
          schema: z.object({
            id: z.number(),
            name: z.string(),
            status: z.string(),
            tags: z.array(z.string()),
            config: z.any().nullable(),
            systemMetadata: z.any().nullable(),
            loggerSettings: z.any().nullable(),
            statusMetadata: z.any().nullable(),
            createdAt: z.string(),
            updatedAt: z.string(),
            statusUpdated: z.string().nullable(),
            projectName: z.string(),
            externalId: z.string().nullable(),
            logNames: z.array(z.object({
              logName: z.string(),
              logType: z.string(),
              logGroup: z.string().nullable(),
            })),
          }).openapi("RunDetailsResponse"),
        },
      },
    },
    404: {
      description: "Run not found",
      content: { "application/json": { schema: ErrorSchema } },
    },
  },
});

router.use("/details/:runId", withApiKey);
router.openapi(getRunDetailsRoute, async (c) => {
  const apiKey = c.get("apiKey");
  const { runId } = c.req.valid("param");
  const prisma = c.get("prisma");

  const run = await queryRunDetails(prisma, {
    organizationId: apiKey.organization.id,
    runId,
  });

  if (!run) {
    return c.json({ error: "Run not found" }, 404);
  }

  return c.json({
    id: run.id,
    name: run.name,
    status: run.status,
    tags: run.tags,
    config: run.config,
    systemMetadata: run.systemMetadata,
    loggerSettings: run.loggerSettings,
    statusMetadata: run.statusMetadata,
    createdAt: run.createdAt.toISOString(),
    updatedAt: run.updatedAt.toISOString(),
    statusUpdated: run.statusUpdated?.toISOString() ?? null,
    projectName: run.projectName,
    externalId: run.externalId,
    logNames: run.logNames,
  }, 200);
});

// ============= Query Logs =============
const queryLogsRoute = createRoute({
  method: "get",
  path: "/logs",
  tags: ["Runs"],
  summary: "Query console logs from a run",
  description: "Returns console logs (stdout/stderr) from ClickHouse. Supports filtering by log type and pagination.",
  security: [{ bearerAuth: [] }],
  request: {
    query: z.object({
      runId: z.coerce.number().openapi({ description: "Numeric run ID" }),
      projectName: z.string().openapi({ description: "Project name" }),
      logType: z.enum(["INFO", "ERROR", "WARNING", "DEBUG", "PRINT"]).optional().openapi({ description: "Filter by log type" }),
      limit: z.coerce.number().min(1).max(10000).default(1000).openapi({ description: "Maximum lines to return" }),
      offset: z.coerce.number().min(0).default(0).openapi({ description: "Number of lines to skip" }),
    }),
  },
  responses: {
    200: {
      description: "Console logs",
      content: {
        "application/json": {
          schema: z.object({
            logs: z.array(z.object({
              time: z.string(),
              logType: z.string(),
              lineNumber: z.number(),
              message: z.string(),
              step: z.number().nullable(),
            })),
            total: z.number(),
          }).openapi("QueryLogsResponse"),
        },
      },
    },
  },
});

router.use(queryLogsRoute.path, withApiKey);
router.openapi(queryLogsRoute, async (c) => {
  const apiKey = c.get("apiKey");
  const { runId, projectName, logType, limit, offset } = c.req.valid("query");

  const result = await queryRunLogs(clickhouse, {
    organizationId: apiKey.organization.id,
    projectName,
    runId,
    logType,
    limit,
    offset,
  });

  return c.json({
    logs: result.logs,
    total: result.total,
  }, 200);
});

// ============= Query Metrics =============
const queryMetricsRoute = createRoute({
  method: "get",
  path: "/metrics",
  tags: ["Runs"],
  summary: "Query metrics from a run",
  description: "Returns time-series metrics from ClickHouse. Supports filtering by metric name and group. Uses reservoir sampling to limit data points.",
  security: [{ bearerAuth: [] }],
  request: {
    query: z.object({
      runId: z.coerce.number().openapi({ description: "Numeric run ID" }),
      projectName: z.string().openapi({ description: "Project name" }),
      logName: z.string().optional().openapi({ description: "Filter by metric name (e.g., train/loss)" }),
      logGroup: z.string().optional().openapi({ description: "Filter by metric group (e.g., train)" }),
      limit: z.coerce.number().min(1).max(10000).default(2000).openapi({ description: "Maximum data points to return" }),
    }),
  },
  responses: {
    200: {
      description: "Metrics data",
      content: {
        "application/json": {
          schema: z.object({
            metrics: z.array(z.object({
              logName: z.string(),
              logGroup: z.string(),
              time: z.string(),
              step: z.number(),
              value: z.number(),
            })),
          }).openapi("QueryMetricsResponse"),
        },
      },
    },
  },
});

router.use(queryMetricsRoute.path, withApiKey);
router.openapi(queryMetricsRoute, async (c) => {
  const apiKey = c.get("apiKey");
  const { runId, projectName, logName, logGroup, limit } = c.req.valid("query");

  const metrics = await queryRunMetrics(clickhouse, {
    organizationId: apiKey.organization.id,
    projectName,
    runId,
    logName,
    logGroup,
    limit,
  });

  return c.json({ metrics }, 200);
});

// ============= Get Files =============
const getFilesRoute = createRoute({
  method: "get",
  path: "/files",
  tags: ["Runs"],
  summary: "Get files and artifacts from a run",
  description: "Returns file metadata with presigned URLs for downloading. URLs are valid for 5 days.",
  security: [{ bearerAuth: [] }],
  request: {
    query: z.object({
      runId: z.coerce.number().openapi({ description: "Numeric run ID" }),
      projectName: z.string().openapi({ description: "Project name" }),
      logName: z.string().optional().openapi({ description: "Filter by log name" }),
      logGroup: z.string().optional().openapi({ description: "Filter by log group" }),
    }),
  },
  responses: {
    200: {
      description: "Files with presigned URLs",
      content: {
        "application/json": {
          schema: z.object({
            files: z.array(z.object({
              fileName: z.string(),
              fileType: z.string(),
              fileSize: z.number(),
              logName: z.string(),
              logGroup: z.string(),
              time: z.string(),
              step: z.number(),
              url: z.string(),
            })),
          }).openapi("GetFilesResponse"),
        },
      },
    },
  },
});

router.use(getFilesRoute.path, withApiKey);
router.openapi(getFilesRoute, async (c) => {
  const apiKey = c.get("apiKey");
  const { runId, projectName, logName, logGroup } = c.req.valid("query");

  const files = await queryRunFiles(clickhouse, {
    organizationId: apiKey.organization.id,
    projectName,
    runId,
    logName,
    logGroup,
  });

  return c.json({ files }, 200);
});

// ============= List Projects =============
const listProjectsRoute = createRoute({
  method: "get",
  path: "/projects",
  tags: ["Projects"],
  summary: "List all projects",
  description: "Returns all projects in the organization associated with the API key.",
  security: [{ bearerAuth: [] }],
  responses: {
    200: {
      description: "List of projects",
      content: {
        "application/json": {
          schema: z.object({
            projects: z.array(z.object({
              id: z.number(),
              name: z.string(),
              createdAt: z.string(),
              updatedAt: z.string(),
              runCount: z.number(),
            })),
          }).openapi("ListProjectsResponse"),
        },
      },
    },
  },
});

router.use(listProjectsRoute.path, withApiKey);
router.openapi(listProjectsRoute, async (c) => {
  const apiKey = c.get("apiKey");
  const prisma = c.get("prisma");

  const projects = await queryAllProjects(prisma, apiKey.organization.id);

  return c.json({
    projects: projects.map((p) => ({
      id: p.id,
      name: p.name,
      createdAt: p.createdAt.toISOString(),
      updatedAt: p.updatedAt.toISOString(),
      runCount: p.runCount,
    })),
  }, 200);
});

// ============= Get Run Statistics =============
const getStatisticsRoute = createRoute({
  method: "get",
  path: "/statistics",
  tags: ["Runs"],
  summary: "Get statistics for a run's metrics",
  description: "Computes statistics (min, max, mean, stddev) and detects anomalies for metrics in a run. Useful for quick analysis without downloading all data points.",
  security: [{ bearerAuth: [] }],
  request: {
    query: z.object({
      runId: z.coerce.number().openapi({ description: "Numeric run ID" }),
      projectName: z.string().openapi({ description: "Project name" }),
      logName: z.string().optional().openapi({ description: "Filter by specific metric name (e.g., train/loss)" }),
      logGroup: z.string().optional().openapi({ description: "Filter by metric group (e.g., train)" }),
    }),
  },
  responses: {
    200: {
      description: "Statistics for metrics",
      content: {
        "application/json": {
          schema: z.object({
            runId: z.number(),
            runName: z.string(),
            projectName: z.string(),
            url: z.string().openapi({ description: "URL to view this run in the UI" }),
            metrics: z.array(z.object({
              logName: z.string(),
              logGroup: z.string(),
              count: z.number(),
              min: z.number(),
              max: z.number(),
              mean: z.number(),
              stddev: z.number(),
              first: z.object({ step: z.number(), value: z.number() }),
              last: z.object({ step: z.number(), value: z.number() }),
              anomalies: z.array(z.object({
                step: z.number(),
                value: z.number(),
                type: z.enum(["spike", "drop", "plateau"]),
                description: z.string(),
              })),
            })),
          }).openapi("GetStatisticsResponse"),
        },
      },
    },
    404: {
      description: "Run not found",
      content: { "application/json": { schema: ErrorSchema } },
    },
  },
});

router.use(getStatisticsRoute.path, withApiKey);
router.openapi(getStatisticsRoute, async (c) => {
  const apiKey = c.get("apiKey");
  const prisma = c.get("prisma");
  const { runId, projectName, logName, logGroup } = c.req.valid("query");

  // Get run info
  const run = await prisma.runs.findFirst({
    where: {
      id: runId,
      organizationId: apiKey.organization.id,
      project: { name: projectName },
    },
    select: { id: true, name: true },
  });

  if (!run) {
    return c.json({ error: "Run not found" }, 404);
  }

  // Query for statistics using ClickHouse aggregation with parameterized queries
  const queryParams: Record<string, unknown> = {
    tenantId: apiKey.organization.id,
    projectName,
    runId,
  };

  let whereClause = `
    tenantId = {tenantId: String}
    AND projectName = {projectName: String}
    AND runId = {runId: UInt64}
  `;

  if (logName) {
    whereClause += ` AND logName = {logName: String}`;
    queryParams.logName = logName;
  }
  if (logGroup) {
    whereClause += ` AND logGroup = {logGroup: String}`;
    queryParams.logGroup = logGroup;
  }

  const statsQuery = `
    SELECT
      logName,
      logGroup,
      count() as count,
      min(value) as min_val,
      max(value) as max_val,
      avg(value) as mean_val,
      stddevPop(value) as stddev_val,
      argMin(value, step) as first_value,
      argMin(step, step) as first_step,
      argMax(value, step) as last_value,
      argMax(step, step) as last_step
    FROM mlop_metrics
    WHERE ${whereClause}
    GROUP BY logName, logGroup
    ORDER BY logName
    LIMIT 100
  `;

  const statsResult = await clickhouse.query(statsQuery, queryParams);
  const statsData = (await statsResult.json()) as Array<{
    logName: string;
    logGroup: string;
    count: string;
    min_val: number;
    max_val: number;
    mean_val: number;
    stddev_val: number;
    first_value: number;
    first_step: string;
    last_value: number;
    last_step: string;
  }>;

  // Detect anomalies for each metric
  const metricsWithAnomalies = await Promise.all(
    statsData.map(async (stat) => {
      const anomalies: Array<{ step: number; value: number; type: "spike" | "drop" | "plateau"; description: string }> = [];

      // Query for potential anomalies (values > 2 stddev from mean)
      if (Number(stat.count) > 10 && stat.stddev_val > 0) {
        const threshold = stat.mean_val + 2 * stat.stddev_val;
        const lowerThreshold = stat.mean_val - 2 * stat.stddev_val;

        const anomalyQuery = `
          SELECT step, value
          FROM mlop_metrics
          WHERE tenantId = {tenantId: String}
            AND projectName = {projectName: String}
            AND runId = {runId: UInt64}
            AND logName = {logName: String}
            AND (value > {threshold: Float64} OR value < {lowerThreshold: Float64})
          ORDER BY step
          LIMIT 10
        `;

        const anomalyResult = await clickhouse.query(anomalyQuery, {
          tenantId: apiKey.organization.id,
          projectName,
          runId,
          logName: stat.logName,
          threshold,
          lowerThreshold,
        });
        const anomalyData = (await anomalyResult.json()) as Array<{ step: string; value: number }>;

        for (const a of anomalyData) {
          const isSpike = a.value > threshold;
          anomalies.push({
            step: Number(a.step),
            value: a.value,
            type: isSpike ? "spike" : "drop",
            description: isSpike
              ? `Value ${a.value.toFixed(4)} is ${((a.value - stat.mean_val) / stat.stddev_val).toFixed(1)} stddev above mean`
              : `Value ${a.value.toFixed(4)} is ${((stat.mean_val - a.value) / stat.stddev_val).toFixed(1)} stddev below mean`,
          });
        }
      }

      return {
        logName: stat.logName,
        logGroup: stat.logGroup,
        count: Number(stat.count),
        min: stat.min_val,
        max: stat.max_val,
        mean: stat.mean_val,
        stddev: stat.stddev_val,
        first: { step: Number(stat.first_step), value: stat.first_value },
        last: { step: Number(stat.last_step), value: stat.last_value },
        anomalies,
      };
    })
  );

  const runUrl = `${env.BETTER_AUTH_URL}/o/${apiKey.organization.slug}/projects/${encodeURIComponent(projectName)}/${sqidEncode(runId)}`;

  return c.json({
    runId,
    runName: run.name,
    projectName,
    url: runUrl,
    metrics: metricsWithAnomalies,
  }, 200);
});

// ============= Compare Runs =============
const compareRunsRoute = createRoute({
  method: "get",
  path: "/compare",
  tags: ["Runs"],
  summary: "Compare metrics across multiple runs",
  description: "Compares statistics for a specific metric across multiple runs. Returns min/max/mean/final values and identifies the best performing run.",
  security: [{ bearerAuth: [] }],
  request: {
    query: z.object({
      runIds: z.string().openapi({ description: "Comma-separated list of run IDs to compare (e.g., '1,2,5')" }),
      projectName: z.string().openapi({ description: "Project name" }),
      logName: z.string().openapi({ description: "Metric name to compare (e.g., 'train/loss')" }),
    }),
  },
  responses: {
    200: {
      description: "Comparison results",
      content: {
        "application/json": {
          schema: z.object({
            projectName: z.string(),
            logName: z.string(),
            comparisonUrl: z.string().openapi({ description: "URL to compare these runs in the UI" }),
            runs: z.array(z.object({
              runId: z.number(),
              runName: z.string(),
              url: z.string().openapi({ description: "URL to view this run" }),
              status: z.string(),
              config: z.any().nullable(),
              stats: z.object({
                count: z.number(),
                min: z.number(),
                max: z.number(),
                mean: z.number(),
                final: z.number().openapi({ description: "Final value (at last step)" }),
                improvement: z.number().openapi({ description: "Percent change from first to last value" }),
              }).nullable(),
            })),
            summary: z.object({
              bestRun: z.object({
                runId: z.number(),
                runName: z.string(),
                reason: z.string(),
              }).nullable(),
              recommendation: z.string(),
            }),
          }).openapi("CompareRunsResponse"),
        },
      },
    },
    400: {
      description: "Invalid request",
      content: { "application/json": { schema: ErrorSchema } },
    },
  },
});

router.use(compareRunsRoute.path, withApiKey);
router.openapi(compareRunsRoute, async (c) => {
  const apiKey = c.get("apiKey");
  const prisma = c.get("prisma");
  const { runIds: runIdsStr, projectName, logName } = c.req.valid("query");

  const MAX_COMPARE_RUNS = 100;
  const runIds = runIdsStr.split(",").map((id) => Number(id.trim())).filter((id) => !isNaN(id));

  if (runIds.length === 0) {
    return c.json({ error: "No valid run IDs provided" }, 400);
  }

  if (runIds.length > MAX_COMPARE_RUNS) {
    return c.json({ error: `Too many runs to compare. Maximum is ${MAX_COMPARE_RUNS}, got ${runIds.length}` }, 400);
  }

  // Get run info
  const runs = await prisma.runs.findMany({
    where: {
      id: { in: runIds },
      organizationId: apiKey.organization.id,
      project: { name: projectName },
    },
    select: { id: true, name: true, status: true, config: true },
  });

  // Query stats for each run using parameterized queries
  const runStats = await Promise.all(
    runs.map(async (run) => {
      const statsQuery = `
        SELECT
          count() as count,
          min(value) as min_val,
          max(value) as max_val,
          avg(value) as mean_val,
          argMin(value, step) as first_value,
          argMax(value, step) as last_value
        FROM mlop_metrics
        WHERE tenantId = {tenantId: String}
          AND projectName = {projectName: String}
          AND runId = {runId: UInt64}
          AND logName = {logName: String}
      `;

      const result = await clickhouse.query(statsQuery, {
        tenantId: apiKey.organization.id,
        projectName,
        runId: run.id,
        logName,
      });
      const data = (await result.json()) as Array<{
        count: string;
        min_val: number;
        max_val: number;
        mean_val: number;
        first_value: number;
        last_value: number;
      }>;

      const stat = data[0];
      const count = Number(stat?.count || 0);

      return {
        runId: Number(run.id),
        runName: run.name,
        url: `${env.BETTER_AUTH_URL}/o/${apiKey.organization.slug}/projects/${encodeURIComponent(projectName)}/${sqidEncode(Number(run.id))}`,
        status: run.status,
        config: run.config,
        stats: count > 0
          ? {
              count,
              min: stat.min_val,
              max: stat.max_val,
              mean: stat.mean_val,
              final: stat.last_value,
              improvement: stat.first_value !== 0
                ? ((stat.first_value - stat.last_value) / stat.first_value) * 100
                : 0,
            }
          : null,
      };
    })
  );

  // Determine best run (for loss-like metrics, lower is better)
  const isLossMetric = logName.toLowerCase().includes("loss") || logName.toLowerCase().includes("error");
  const validRuns = runStats.filter((r) => r.stats !== null);

  let bestRun: { runId: number; runName: string; reason: string } | null = null;
  if (validRuns.length > 0) {
    if (isLossMetric) {
      const best = validRuns.reduce((a, b) =>
        (a.stats?.final ?? Infinity) < (b.stats?.final ?? Infinity) ? a : b
      );
      bestRun = {
        runId: best.runId,
        runName: best.runName,
        reason: `Lowest final ${logName}: ${best.stats?.final.toFixed(4)}`,
      };
    } else {
      const best = validRuns.reduce((a, b) =>
        (a.stats?.final ?? -Infinity) > (b.stats?.final ?? -Infinity) ? a : b
      );
      bestRun = {
        runId: best.runId,
        runName: best.runName,
        reason: `Highest final ${logName}: ${best.stats?.final.toFixed(4)}`,
      };
    }
  }

  // Generate recommendation
  let recommendation = "";
  if (bestRun && validRuns.length > 1) {
    const bestRunData = validRuns.find((r) => r.runId === bestRun!.runId);
    if (bestRunData?.stats?.improvement) {
      recommendation = `${bestRun.runName} achieved ${Math.abs(bestRunData.stats.improvement).toFixed(1)}% ${
        bestRunData.stats.improvement > 0 ? "improvement" : "degradation"
      } in ${logName} during training.`;
    }
  } else if (validRuns.length === 0) {
    recommendation = `No data found for metric '${logName}' in the specified runs.`;
  }

  const runIdsParam = runIds.join(",");
  const comparisonUrl = `${env.BETTER_AUTH_URL}/o/${apiKey.organization.slug}/projects/${encodeURIComponent(projectName)}?runs=${runIdsParam}`;

  return c.json({
    projectName,
    logName,
    comparisonUrl,
    runs: runStats,
    summary: {
      bestRun,
      recommendation,
    },
  }, 200);
});

// ============= Get Run by ID (SQID Decode) =============
// NOTE: This catch-all route MUST be registered last to avoid intercepting
// other routes like /metrics, /projects, /logs, etc.
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

export default router;
