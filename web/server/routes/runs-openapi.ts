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
import { triggerLinearSyncForTags } from "../lib/linear-sync";
import { resolveForkParent, validateForkStep } from "../lib/fork-helpers";
import {
  queryDistinctMetrics,
  queryMetricSortedRunIds,
  type MetricAggregation,
} from "../lib/queries/metric-summaries";
import type { prisma } from "../lib/prisma";
import type { ApiKey, Organization, User } from "@prisma/client";
import { extractAndUpsertColumnKeys } from "../lib/extract-column-keys";
import { deepMerge } from "../lib/deep-merge";
import { generateRunPrefix } from "../lib/run-prefix";
import { transitionRunStatus, recordRunCreatedEvent } from "../lib/run-status";
import { attachFieldValues } from "../trpc/routers/runs/procs/list-runs";

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
            forkRunId: z.number().optional().nullable().openapi({ description: "ID of the run to fork from. Creates a child run that inherits metrics up to forkStep." }),
            forkStep: z.number().optional().nullable().openapi({ description: "Step at which to fork. Required when forkRunId is provided. The child run inherits all metrics up to and including this step." }),
            inheritConfig: z.boolean().optional().nullable().openapi({ description: "Whether to inherit config from the parent run (default: true). Only applies when forkRunId is provided." }),
            inheritTags: z.boolean().optional().nullable().openapi({ description: "Whether to inherit tags from the parent run (default: false). Only applies when forkRunId is provided." }),
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
            number: z.number().nullable().openapi({ description: "Sequential run number within the project (for display IDs)" }),
            displayId: z.string().nullable().openapi({ description: "Human-readable display ID (e.g., 'MMP-1')" }),
            projectName: z.string().openapi({ description: "Name of the project" }),
            organizationSlug: z.string().openapi({ description: "Organization slug" }),
            url: z.string().openapi({ description: "URL to view the run" }),
            resumed: z.boolean().openapi({ description: "Whether an existing run was resumed (true) or a new run was created (false)" }),
            forkedFromRunId: z.number().nullable().optional().openapi({ description: "ID of the parent run this was forked from (null if not forked)" }),
            forkStep: z.number().nullable().optional().openapi({ description: "Step at which the fork occurred (null if not forked)" }),
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
  const { runName, projectName, externalId, tags, loggerSettings, systemMetadata, config, createdAt, updatedAt, forkRunId, forkStep, inheritConfig, inheritTags } = c.req.valid("json");

  const ctx = await createContext({ hono: c });

  // Upsert project first (needed for both new and resumed runs)
  // Generate prefix on creation; existing projects keep their prefix
  const generatedPrefix = generateRunPrefix(projectName);
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
      runPrefix: generatedPrefix,
      createdAt: createdAt ? new Date(createdAt) : new Date(),
      updatedAt: updatedAt ? new Date(updatedAt) : new Date(),
    },
    select: { id: true, runPrefix: true, nextRunNumber: true },
  });

  // Backfill prefix for existing projects that don't have one
  let projectRunPrefix = project.runPrefix;
  if (!projectRunPrefix) {
    await ctx.prisma.projects.update({
      where: { id: project.id },
      data: { runPrefix: generatedPrefix },
    });
    projectRunPrefix = generatedPrefix;
  }

  let run: { id: bigint; number: number | null } | null = null;
  let resumed = false;
  let resumedFromTerminal = false;

  // If externalId is provided, check if a run with this ID already exists (Neptune-style resume)
  if (externalId) {
    const existingRun = await ctx.prisma.runs.findFirst({
      where: {
        externalId,
        organizationId: apiKey.organization.id,
        projectId: project.id,
      },
      select: { id: true, number: true, status: true },
    });

    if (existingRun) {
      run = { id: existingRun.id, number: existingRun.number };
      resumed = true;
      resumedFromTerminal = existingRun.status !== RunStatus.RUNNING;
    }
  }

  // Validate fork parameters
  let resolvedForkRunId: bigint | null = null;
  let resolvedForkStep: bigint | null = null;
  let inheritedConfig: unknown = null;
  let inheritedTags: string[] = [];

  if (forkRunId && !resumed) {
    if (forkStep === undefined || forkStep === null) {
      return c.json({ error: "forkStep is required when forkRunId is provided" }, 400);
    }

    // Validate that the requested parent run exists and belongs to the same org+project
    const requestedParent = await ctx.prisma.runs.findFirst({
      where: {
        id: BigInt(forkRunId),
        organizationId: apiKey.organization.id,
        projectId: project.id,
      },
      select: {
        id: true,
        config: true,
        tags: true,
        forkedFromRunId: true,
        forkStep: true,
      },
    });

    if (!requestedParent) {
      return c.json({ error: "Fork parent run not found in this project" }, 400);
    }

    // Resolve lineage: walk up to find the ancestor that owns the forkStep
    const resolvedParent = await resolveForkParent(
      ctx.prisma, requestedParent, forkStep, apiKey.organization.id
    );

    resolvedForkRunId = resolvedParent.id;
    resolvedForkStep = BigInt(forkStep);

    // Validate forkStep against the resolved parent's actual max step
    const validationError = await validateForkStep(
      clickhouse, apiKey.organization.id, projectName, resolvedParent.id, forkStep
    );
    if (validationError) {
      return c.json({ error: validationError }, 400);
    }

    // Inherit config from the resolved parent if requested (default: true)
    if (inheritConfig !== false && resolvedParent.config && resolvedParent.config !== null) {
      inheritedConfig = resolvedParent.config;
    }

    // Inherit tags from the resolved parent if requested (default: false)
    if (inheritTags === true) {
      inheritedTags = resolvedParent.tags;
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

      // Atomically increment the project's run counter and create the run
      const updatedProject = await ctx.prisma.projects.update({
        where: { id: project.id },
        data: { nextRunNumber: { increment: 1 } },
        select: { nextRunNumber: true },
      });
      const runNumber = updatedProject.nextRunNumber - 1;

      // Merge inherited config with explicitly provided config (explicit wins)
      let finalConfig = parsedConfig;
      if (inheritedConfig && parsedConfig === Prisma.DbNull) {
        finalConfig = inheritedConfig;
      } else if (inheritedConfig && parsedConfig !== Prisma.DbNull) {
        // Shallow merge: explicit config overrides inherited keys
        finalConfig = { ...(inheritedConfig as Record<string, unknown>), ...(parsedConfig as Record<string, unknown>) };
      }

      // Merge inherited tags with explicit tags
      const explicitTags = tags || [];
      const finalTags = inheritedTags.length > 0
        ? [...new Set([...inheritedTags, ...explicitTags])]
        : explicitTags;

      // Create the run and its initial `null -> RUNNING` status event
      // atomically so the timeline cannot miss the creation event if a
      // crash happens between the two writes.
      run = await ctx.prisma.$transaction(async (tx) => {
        const created = await tx.runs.create({
          data: {
            name: runName,
            number: runNumber,
            externalId: externalId || null,
            projectId: project.id,
            organizationId: apiKey.organization.id,
            tags: finalTags,
            status: RunStatus.RUNNING,
            loggerSettings: parsedLoggerSettings,
            systemMetadata: parsedSystemMetadata,
            config: finalConfig,
            createdById: apiKey.user.id,
            creatorApiKeyId: apiKey.id,
            forkedFromRunId: resolvedForkRunId,
            forkStep: resolvedForkStep,
          },
          select: { id: true, number: true },
        });
        await recordRunCreatedEvent(tx, {
          runId: created.id,
          source: "api",
          apiKeyId: apiKey.id,
          actorId: apiKey.user.id,
        });
        return created;
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
          select: { id: true, number: true, status: true },
        });
        if (existingRun) {
          run = { id: existingRun.id, number: existingRun.number };
          resumed = true;
          resumedFromTerminal = existingRun.status !== RunStatus.RUNNING;
        }
      }

      if (!run) {
        console.error("Failed to create run:", error);
        return c.json({ error: "Failed to create run" }, 500);
      }
    }
  }

  // Resumed runs coming from a terminal state need to be flipped back to
  // RUNNING so the SDK can keep logging. This mirrors /api/runs/resume but
  // covers the Neptune-style externalId path used by DDP multi-node restarts.
  if (resumed && resumedFromTerminal && run) {
    await transitionRunStatus(ctx.prisma, {
      runId: run.id,
      toStatus: RunStatus.RUNNING,
      source: "resume",
      organizationId: apiKey.organization.id,
      apiKeyId: apiKey.id,
      actorId: apiKey.user.id,
    });
  }

  // Fire-and-forget: cache column keys for fast search
  if (!resumed) {
    // New run — materialize whatever config/systemMetadata was provided.
    const parsedCfg = config && config !== "null" ? JSON.parse(config) : null;
    const parsedSm = systemMetadata && systemMetadata !== "null" ? JSON.parse(systemMetadata) : null;
    if (parsedCfg || parsedSm) {
      extractAndUpsertColumnKeys(
        ctx.prisma,
        apiKey.organization.id,
        project.id,
        parsedCfg,
        parsedSm,
        run.id
      ).catch((err) => {
        console.error("Failed to extract/upsert column keys on run creation:", err);
      });
    }
  } else {
    // Resumed run (old SDK path via externalId) — deep-merge any new config
    // into the existing run so data from other processes is not lost.
    const parsedCfg = config && config !== "null" ? JSON.parse(config) : null;
    if (parsedCfg && typeof parsedCfg === "object" && !Array.isArray(parsedCfg)) {
      const existingRun = await ctx.prisma.runs.findUnique({
        where: { id: run.id },
        select: { config: true, systemMetadata: true, projectId: true },
      });
      if (existingRun) {
        const existingConfig = (existingRun.config || {}) as Record<string, unknown>;
        const mergedConfig = deepMerge(existingConfig, parsedCfg);
        ctx.prisma.runs.update({
          where: { id: run.id },
          data: { config: mergedConfig as Prisma.InputJsonValue },
        }).then(() => {
          extractAndUpsertColumnKeys(
            ctx.prisma,
            apiKey.organization.id,
            existingRun.projectId,
            mergedConfig,
            existingRun.systemMetadata,
            run!.id
          ).catch((err) => {
            console.error("Failed to extract/upsert column keys on resumed run config merge:", err);
          });
        }).catch((err) => {
          console.error("Failed to merge config on resumed run:", err);
        });
      }
    }
  }

  const encodedRunId = sqidEncode(run.id);
  const runUrl = `${env.BETTER_AUTH_URL}/o/${apiKey.organization.slug}/projects/${encodeURIComponent(projectName)}/${encodedRunId}`;

  const displayId = run.number != null && projectRunPrefix
    ? `${projectRunPrefix}-${run.number}`
    : null;

  // Fire-and-forget Linear sync for any linear: tags on new runs
  if (!resumed && tags?.length) {
    triggerLinearSyncForTags(ctx.prisma, apiKey.organization.id, tags);
  }

  return c.json({
    runId: Number(run.id),
    number: run.number,
    displayId,
    projectName,
    organizationSlug: apiKey.organization.slug,
    url: runUrl,
    resumed,
    forkedFromRunId: resolvedForkRunId != null ? Number(resolvedForkRunId) : null,
    forkStep: resolvedForkStep != null ? Number(resolvedForkStep) : null,
  }, 200);
});

// ============= Resume Existing Run =============
const resumeRunRoute = createRoute({
  method: "post",
  path: "/resume",
  tags: ["Runs"],
  summary: "Resume an existing run",
  description: "Resumes an existing run, setting its status back to RUNNING. Returns the same response format as create. Use this when you want to log additional data (e.g., evaluation metrics) to a previously completed run. Provide exactly one of: runId (numeric), displayId (e.g., 'MMP-1'), or externalId (user-provided).",
  security: [{ bearerAuth: [] }],
  request: {
    body: {
      content: {
        "application/json": {
          schema: z.object({
            runId: z.number().optional().openapi({ description: "Numeric ID of the run to resume", example: 123 }),
            displayId: z.string().optional().openapi({ description: "Human-readable display ID (e.g., 'MMP-1')", example: "MMP-1" }),
            externalId: z.string().optional().openapi({ description: "User-provided external ID", example: "my-training-run-v1" }),
            projectName: z.string().optional().openapi({ description: "Project name (required when using externalId, since externalId is scoped to a project)", example: "my-project" }),
          }).refine(
            (data) => [data.runId, data.displayId, data.externalId].filter((v) => v !== undefined).length === 1,
            { message: "Provide exactly one of: runId, displayId, or externalId" },
          ),
        },
      },
    },
  },
  responses: {
    200: {
      description: "Run resumed successfully",
      content: {
        "application/json": {
          schema: z.object({
            runId: z.number().openapi({ description: "Numeric ID of the resumed run" }),
            number: z.number().nullable().openapi({ description: "Sequential run number within the project" }),
            displayId: z.string().nullable().openapi({ description: "Human-readable display ID (e.g., 'MMP-1')" }),
            projectName: z.string().openapi({ description: "Name of the project" }),
            organizationSlug: z.string().openapi({ description: "Organization slug" }),
            url: z.string().openapi({ description: "URL to view the run" }),
            resumed: z.boolean().openapi({ description: "Always true for this endpoint" }),
          }).openapi("ResumeRunResponse"),
        },
      },
    },
    400: {
      description: "Bad request",
      content: { "application/json": { schema: ErrorSchema } },
    },
    401: {
      description: "Unauthorized",
      content: { "application/json": { schema: ErrorSchema } },
    },
    404: {
      description: "Run not found",
      content: { "application/json": { schema: ErrorSchema } },
    },
  },
});

router.use(resumeRunRoute.path, withApiKey);
router.openapi(resumeRunRoute, async (c) => {
  const apiKey = c.get("apiKey");
  const body = c.req.valid("json");

  const ctx = await createContext({ hono: c });
  const organizationId = apiKey.organization.id;

  let run: {
    id: bigint;
    number: number | null;
    status: string;
    project: { name: string; runPrefix: string | null };
  } | null = null;

  if (body.runId !== undefined) {
    // Lookup by numeric ID
    run = await ctx.prisma.runs.findFirst({
      where: { id: body.runId, organizationId },
      select: {
        id: true, number: true, status: true,
        project: { select: { name: true, runPrefix: true } },
      },
    });
  } else if (body.displayId !== undefined) {
    // Parse display ID (e.g., "MMP-1" → prefix "MMP", number 1)
    const match = body.displayId.match(/^([^-]+)-(\d+)$/);
    if (!match) {
      return c.json({ error: "Invalid displayId format. Expected PREFIX-NUMBER (e.g., 'MMP-1')" }, 400);
    }
    const [, prefix, numberStr] = match;
    run = await ctx.prisma.runs.findFirst({
      where: {
        number: parseInt(numberStr, 10),
        organizationId,
        project: { runPrefix: prefix.toUpperCase() },
      },
      select: {
        id: true, number: true, status: true,
        project: { select: { name: true, runPrefix: true } },
      },
    });
  } else if (body.externalId !== undefined) {
    // Lookup by external ID (requires projectName since externalId is scoped to project)
    if (!body.projectName) {
      return c.json({ error: "projectName is required when using externalId" }, 400);
    }
    run = await ctx.prisma.runs.findFirst({
      where: {
        externalId: body.externalId,
        organizationId,
        project: { name: body.projectName, organizationId },
      },
      select: {
        id: true, number: true, status: true,
        project: { select: { name: true, runPrefix: true } },
      },
    });
  }

  if (!run) {
    return c.json({ error: "Run not found" }, 404);
  }

  // Set run status back to RUNNING so the SDK can log new data.
  // Only terminal-to-RUNNING transitions emit a timeline event; a resume
  // against an already-RUNNING run is a no-op.
  if (run.status !== RunStatus.RUNNING) {
    await transitionRunStatus(ctx.prisma, {
      runId: run.id,
      toStatus: RunStatus.RUNNING,
      source: "resume",
      organizationId,
      apiKeyId: apiKey.id,
      actorId: apiKey.user.id,
    });
  }

  const encodedRunId = sqidEncode(run.id);
  const projectName = run.project.name;
  const runUrl = `${env.BETTER_AUTH_URL}/o/${apiKey.organization.slug}/projects/${encodeURIComponent(projectName)}/${encodedRunId}`;

  const computedDisplayId = run.number != null && run.project.runPrefix
    ? `${run.project.runPrefix}-${run.number}`
    : null;

  return c.json({
    runId: Number(run.id),
    number: run.number,
    displayId: computedDisplayId,
    projectName,
    organizationSlug: apiKey.organization.slug,
    url: runUrl,
    resumed: true,
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
    select: { id: true, loggerSettings: true },
  });

  if (!run) {
    return c.json({ error: "Run not found" }, 404);
  }

  let updatedLoggerSettings = (run.loggerSettings || {}) as Record<string, unknown>;
  let loggerSettingsChanged = false;
  if (loggerSettings && loggerSettings !== "null") {
    try {
      const newLoggerSettings = JSON.parse(loggerSettings) as Record<string, unknown>;
      updatedLoggerSettings = deepMerge(updatedLoggerSettings, newLoggerSettings);
      loggerSettingsChanged = true;
    } catch (error) {
      return c.json({ error: "Invalid loggerSettings JSON" }, 400);
    }
  }

  let parsedStatusMetadata: Prisma.InputJsonValue | null | undefined = undefined;
  if (statusMetadata) {
    try {
      parsedStatusMetadata = JSON.parse(statusMetadata) as Prisma.InputJsonValue;
    } catch (error) {
      return c.json({ error: "Invalid statusMetadata JSON" }, 400);
    }
  } else if (statusMetadata === null) {
    parsedStatusMetadata = null;
  }

  await transitionRunStatus(c.get("prisma"), {
    runId: BigInt(runId),
    toStatus: status,
    source: "api",
    metadata: parsedStatusMetadata,
    loggerSettingsPatch: loggerSettingsChanged ? updatedLoggerSettings : undefined,
    organizationId: apiKey.organization.id,
    apiKeyId: apiKey.id,
    actorId: apiKey.user.id,
  });

  return c.json({ success: true }, 200);
});

// ============= Status History =============
const StatusEventSchema = z.object({
  id: z.string(),
  runId: z.number(),
  fromStatus: z.string().nullable(),
  toStatus: z.string(),
  source: z.string(),
  metadata: z.any().nullable(),
  actorId: z.string().nullable(),
  apiKeyId: z.string().nullable(),
  createdAt: z.string(),
});

const statusHistoryRoute = createRoute({
  method: "get",
  path: "/status/history",
  tags: ["Runs"],
  summary: "Get run status transition history",
  description:
    "Returns the ordered list of status transition events for a run " +
    "(oldest first). Includes implicit creation event, API-driven updates, " +
    "resumes, and backend-driven stale/threshold transitions.",
  security: [{ bearerAuth: [] }],
  request: {
    query: z.object({
      runId: z.coerce.number().openapi({ description: "Numeric run ID" }),
    }),
  },
  responses: {
    200: {
      description: "Status history",
      content: {
        "application/json": {
          schema: z.object({
            runId: z.number(),
            events: z.array(StatusEventSchema),
          }).openapi("RunStatusHistoryResponse"),
        },
      },
    },
    404: {
      description: "Run not found",
      content: { "application/json": { schema: ErrorSchema } },
    },
  },
});

router.use(statusHistoryRoute.path, withApiKey);
router.openapi(statusHistoryRoute, async (c) => {
  const apiKey = c.get("apiKey");
  const { runId } = c.req.valid("query");
  const prisma = c.get("prisma");

  const run = await prisma.runs.findUnique({
    where: { id: runId, organizationId: apiKey.organization.id },
    select: { id: true },
  });
  if (!run) {
    return c.json({ error: "Run not found" }, 404);
  }

  const events = await prisma.runStatusEvent.findMany({
    where: { runId: run.id },
    orderBy: { createdAt: "asc" },
  });

  return c.json({
    runId,
    events: events.map((e) => ({
      id: e.id.toString(),
      runId: Number(e.runId),
      fromStatus: e.fromStatus,
      toStatus: e.toStatus,
      source: e.source,
      metadata: e.metadata,
      actorId: e.actorId,
      apiKeyId: e.apiKeyId,
      createdAt: e.createdAt.toISOString(),
    })),
  }, 200);
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

  // Fetch old tags before update so we can sync removed linear: tags
  const existingRun = await c.get("prisma").runs.findFirst({
    where: { id: runId, organizationId: apiKey.organization.id },
    select: { tags: true },
  });
  const previousTags = existingRun?.tags ?? [];

  const result = await c.get("prisma").runs.updateMany({
    where: { id: runId, organizationId: apiKey.organization.id },
    data: { tags },
  });

  if (result.count === 0) {
    return c.json({ error: "Run not found" }, 404);
  }

  // Fire-and-forget Linear sync for any linear: tags (including removed ones)
  triggerLinearSyncForTags(c.get("prisma"), apiKey.organization.id, tags, previousTags);

  return c.json({ success: true }, 200);
});

// ============= Update Notes =============
const updateNotesRoute = createRoute({
  method: "post",
  path: "/notes/update",
  tags: ["Runs"],
  summary: "Update run notes",
  description: "Updates the notes/description on a run. Set to null or empty string to clear.",
  security: [{ bearerAuth: [] }],
  request: {
    body: {
      content: {
        "application/json": {
          schema: z.object({
            runId: z.number().openapi({ description: "Numeric ID of the run" }),
            notes: z.string().max(1000).nullable().openapi({ description: "Notes/description for the run (max 1000 chars). Set to null or empty string to clear." }),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: "Notes updated successfully",
      content: { "application/json": { schema: SuccessSchema } },
    },
    404: {
      description: "Run not found",
      content: { "application/json": { schema: ErrorSchema } },
    },
  },
});

router.use(updateNotesRoute.path, withApiKey);
router.openapi(updateNotesRoute, async (c) => {
  const apiKey = c.get("apiKey");
  const { runId, notes } = c.req.valid("json");

  const result = await c.get("prisma").runs.updateMany({
    where: { id: runId, organizationId: apiKey.organization.id },
    data: { notes: notes || null },
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

  let updatedConfig = (run.config || {}) as Record<string, unknown>;
  if (config && config !== "null") {
    try {
      const newConfig = JSON.parse(config);
      if (typeof newConfig !== "object" || newConfig === null || Array.isArray(newConfig)) {
        return c.json({ error: "Invalid config JSON: expected an object" }, 400);
      }
      updatedConfig = deepMerge(updatedConfig, newConfig as Record<string, unknown>);
    } catch (error) {
      return c.json({ error: "Invalid config JSON" }, 400);
    }
  }

  await c.get("prisma").runs.update({
    where: { id: runId, organizationId: apiKey.organization.id },
    data: {
      config: Object.keys(updatedConfig).length > 0 ? (updatedConfig as Prisma.InputJsonValue) : Prisma.DbNull,
    },
  });

  // Fire-and-forget: cache new column keys + field values from updated config
  extractAndUpsertColumnKeys(
    c.get("prisma"),
    apiKey.organization.id,
    run.projectId,
    updatedConfig,
    run.systemMetadata,
    run.id
  ).catch((err) => {
    console.error("Failed to extract/upsert column keys on config update:", err);
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
      // Opt-in flag for the V8-heap CI probe. When true, attaches
      // `_flatConfig` / `_flatSystemMetadata` blobs per run — the same shape
      // tRPC runs.list produces for the frontend. Default false keeps the
      // response lean for SDK/MCP callers (back-compat preserved).
      includeFieldValues: z.coerce.boolean().optional().default(false).openapi({
        description: "When true, attach _flatConfig and _flatSystemMetadata to each run. Off by default for lean SDK responses.",
        example: false,
      }),
      // JSON-encoded array of {source, key} pairs. Only meaningful when
      // includeFieldValues=true. Empty array skips field-value fetch entirely.
      // Mirrors the tRPC runs.list `visibleColumns` input.
      visibleColumns: z.string().optional().openapi({
        description: "JSON-encoded array of {source:'config'|'systemMetadata', key:string}. Restricts _flatConfig/_flatSystemMetadata to the listed keys. Empty array = no field values.",
        example: '[{"source":"config","key":"lr"}]',
      }),
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
              number: z.number().nullable().openapi({ description: "Sequential run number within the project" }),
              displayId: z.string().nullable().openapi({ description: "Human-readable display ID (e.g., 'MMP-1')" }),
              status: z.string().openapi({ description: "Run status" }),
              tags: z.array(z.string()).openapi({ description: "Run tags" }),
              createdAt: z.string().openapi({ description: "Creation timestamp" }),
              _flatConfig: z.record(z.unknown()).optional().openapi({ description: "Flattened config — only present when includeFieldValues=true" }),
              _flatSystemMetadata: z.record(z.unknown()).optional().openapi({ description: "Flattened systemMetadata — only present when includeFieldValues=true" }),
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
  const { projectName, search, tags: tagsParam, limit, includeFieldValues, visibleColumns: visibleColumnsRaw } = c.req.valid("query");
  const prisma = c.get("prisma");

  // Parse tags from comma-separated string
  const tags = tagsParam ? tagsParam.split(",").map((t) => t.trim()).filter(Boolean) : [];

  // Parse visibleColumns if provided (JSON-encoded array of {source, key}).
  // Tolerates malformed JSON by treating it as unset — the caller just gets
  // the legacy full-blob behavior.
  let visibleColumns: { source: "config" | "systemMetadata"; key: string }[] | undefined;
  if (includeFieldValues && visibleColumnsRaw) {
    try {
      const parsed = JSON.parse(visibleColumnsRaw);
      if (Array.isArray(parsed)) {
        visibleColumns = parsed.filter(
          (v): v is { source: "config" | "systemMetadata"; key: string } =>
            v && typeof v === "object" &&
            (v.source === "config" || v.source === "systemMetadata") &&
            typeof v.key === "string",
        ).slice(0, 1000);
        // Defense-in-depth: cap at 1000 entries. Route already requires API
        // key auth, but a buggy authenticated client passing a huge array
        // would generate a massive Prisma OR clause and strain the DB.
        // Real frontend traffic is orders of magnitude below this cap.
      }
    } catch {
      // Ignore malformed input; fall through to unfiltered attach.
    }
  }

  // Get the project
  const project = await prisma.projects.findFirst({
    where: {
      name: projectName,
      organizationId: apiKey.organization.id,
    },
    select: { id: true, runPrefix: true },
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
      number: true,
      status: true,
      tags: true,
      createdAt: true,
    },
  });

  // Optional flat-blob enrichment — the failure surface the V8-heap CI probe
  // exercises. `attachFieldValues` is the same helper tRPC runs.list uses, so
  // this endpoint reflects whatever trim behavior (or lack thereof) lives
  // there. Pre-fix: 2-arg signature, visibleColumns silently ignored by JS,
  // returns full blobs → probe OOMs. Post-fix (once the `visibleColumns`
  // support lands in attachFieldValues): 3-arg signature, respects the
  // trim, returns empty blobs when visibleColumns=[] → probe passes.
  //
  // The function cast is intentional and CI-only: papers over the pre-fix
  // TypeScript signature so this code compiles cleanly on main before the
  // fix lands. JavaScript ignores extra args at runtime — no behavioral risk.
  type BaseRun = typeof runs extends Array<infer U> ? U : never;
  type EnrichedRun = BaseRun & {
    _flatConfig?: Record<string, unknown>;
    _flatSystemMetadata?: Record<string, unknown>;
  };
  type AttachFn = (
    prisma: unknown,
    runs: BaseRun[],
    visibleColumns?: { source: "config" | "systemMetadata"; key: string }[],
  ) => Promise<EnrichedRun[]>;

  const enriched: EnrichedRun[] = includeFieldValues
    ? await (attachFieldValues as unknown as AttachFn)(prisma, runs, visibleColumns)
    : runs;

  return c.json({
    runs: enriched.map((run) => ({
      id: Number(run.id),
      name: run.name,
      number: run.number,
      displayId: run.number != null && project?.runPrefix
        ? `${project.runPrefix}-${run.number}`
        : null,
      status: run.status,
      tags: run.tags,
      createdAt: run.createdAt.toISOString(),
      ...(includeFieldValues
        ? {
            _flatConfig: run._flatConfig as Record<string, unknown> | undefined,
            _flatSystemMetadata: run._flatSystemMetadata as Record<string, unknown> | undefined,
          }
        : {}),
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
            number: z.number().nullable().openapi({ description: "Sequential run number within the project" }),
            displayId: z.string().nullable().openapi({ description: "Human-readable display ID (e.g., 'MMP-1')" }),
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
            forkedFromRunId: z.number().nullable(),
            forkStep: z.number().nullable(),
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
    number: run.number,
    displayId: run.displayId,
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
    forkedFromRunId: run.forkedFromRunId,
    forkStep: run.forkStep,
    logNames: run.logNames,
  }, 200);
});

// ============= Get Run Details by Display ID =============
const getRunByDisplayIdRoute = createRoute({
  method: "get",
  path: "/details/by-display-id/{displayId}",
  tags: ["Runs"],
  summary: "Get run details by display ID",
  description: "Resolves a human-readable display ID (e.g., 'MMP-1') to a run and returns its details.",
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({
      displayId: z.string().openapi({ description: "Display ID in PREFIX-NUMBER format (e.g., 'MMP-1')" }),
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
            number: z.number().nullable(),
            displayId: z.string().nullable(),
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
          }).openapi("RunDetailsByDisplayIdResponse"),
        },
      },
    },
    400: {
      description: "Invalid display ID format",
      content: { "application/json": { schema: ErrorSchema } },
    },
    404: {
      description: "Run not found",
      content: { "application/json": { schema: ErrorSchema } },
    },
  },
});

router.use("/details/by-display-id/:displayId", withApiKey);
router.openapi(getRunByDisplayIdRoute, async (c) => {
  const apiKey = c.get("apiKey");
  const { displayId } = c.req.valid("param");
  const prismaClient = c.get("prisma");
  const organizationId = apiKey.organization.id;

  const match = displayId.match(/^([A-Za-z0-9]+)-(\d+)$/);
  if (!match) {
    return c.json({ error: "Invalid display ID format. Expected PREFIX-NUMBER (e.g., 'MMP-1')" }, 400);
  }

  const [, prefix, numberStr] = match;
  const run = await prismaClient.runs.findFirst({
    where: {
      number: parseInt(numberStr, 10),
      organizationId,
      project: {
        runPrefix: prefix.toUpperCase(),
      },
    },
    include: {
      project: { select: { name: true, runPrefix: true } },
      logs: {
        select: { logName: true, logType: true, logGroup: true },
        take: 1000,
      },
    },
  });

  if (!run) {
    return c.json({ error: "Run not found" }, 404);
  }

  const computedDisplayId = run.number != null && run.project.runPrefix
    ? `${run.project.runPrefix}-${run.number}`
    : null;

  return c.json({
    id: Number(run.id),
    name: run.name,
    number: run.number,
    displayId: computedDisplayId,
    status: run.status,
    tags: run.tags,
    config: run.config,
    systemMetadata: run.systemMetadata,
    loggerSettings: run.loggerSettings,
    statusMetadata: run.statusMetadata,
    createdAt: run.createdAt.toISOString(),
    updatedAt: run.updatedAt.toISOString(),
    statusUpdated: run.statusUpdated?.toISOString() ?? null,
    projectName: run.project.name,
    externalId: run.externalId,
    logNames: run.logs.map((log) => ({
      logName: log.logName,
      logType: log.logType,
      logGroup: log.logGroup,
    })),
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
  description: "Returns time-series metrics from ClickHouse. Supports filtering by metric name, group, and step range. Uses reservoir sampling to limit data points.",
  security: [{ bearerAuth: [] }],
  request: {
    query: z.object({
      runId: z.coerce.number().openapi({ description: "Numeric run ID" }),
      projectName: z.string().openapi({ description: "Project name" }),
      logName: z.string().optional().openapi({ description: "Filter by metric name (e.g., train/loss)" }),
      logGroup: z.string().optional().openapi({ description: "Filter by metric group (e.g., train)" }),
      limit: z.coerce.number().min(1).max(10000).default(2000).openapi({ description: "Maximum data points to return" }),
      stepMin: z.coerce.number().int().min(0).optional().openapi({ description: "Minimum step number (inclusive). Use with stepMax to query a specific range of steps." }),
      stepMax: z.coerce.number().int().min(0).optional().openapi({ description: "Maximum step number (inclusive). Use with stepMin to query a specific range of steps." }),
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
  const { runId, projectName, logName, logGroup, limit, stepMin, stepMax } = c.req.valid("query");

  const metrics = await queryRunMetrics(clickhouse, {
    organizationId: apiKey.organization.id,
    projectName,
    runId,
    logName,
    logGroup,
    limit,
    stepMin,
    stepMax,
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

// ============= List Metric Names =============
const listMetricNamesRoute = createRoute({
  method: "get",
  path: "/metric-names",
  tags: ["Runs"],
  summary: "List distinct metric names in a project",
  description: "Returns distinct metric names from the pre-computed metric summaries table. Useful for discovering available metrics before querying leaderboard or statistics. Optionally filter by a search substring or specific run IDs.",
  security: [{ bearerAuth: [] }],
  request: {
    query: z.object({
      projectName: z.string().openapi({ description: "Project name" }),
      search: z.string().optional().openapi({ description: "Substring search to filter metric names (e.g., 'loss')" }),
      runIds: z.string().optional().openapi({ description: "Comma-separated run IDs to scope the search (e.g., '1,2,5')" }),
      limit: z.coerce.number().optional().default(500).openapi({ description: "Maximum number of metric names to return (default: 500)" }),
    }),
  },
  responses: {
    200: {
      description: "List of distinct metric names",
      content: {
        "application/json": {
          schema: z.object({
            projectName: z.string(),
            metricNames: z.array(z.string()),
          }).openapi("ListMetricNamesResponse"),
        },
      },
    },
  },
});

router.use(listMetricNamesRoute.path, withApiKey);
router.openapi(listMetricNamesRoute, async (c) => {
  const apiKey = c.get("apiKey");
  const { projectName, search, runIds: runIdsStr, limit } = c.req.valid("query");

  let runIds: number[] | undefined;
  if (runIdsStr) {
    runIds = runIdsStr.split(",").map((id) => Number(id.trim())).filter((id) => !isNaN(id));
    if (runIds.length === 0) {
      runIds = undefined;
    }
  }

  const { metricNames } = await queryDistinctMetrics(clickhouse, {
    organizationId: apiKey.organization.id,
    projectName,
    search: search || undefined,
    limit: Math.min(limit, 500),
    runIds,
  });

  return c.json({
    projectName,
    metricNames,
  }, 200);
});

// ============= Leaderboard =============
const VALID_AGGREGATIONS = ["MIN", "MAX", "AVG", "LAST", "VARIANCE"] as const;

const leaderboardRoute = createRoute({
  method: "get",
  path: "/leaderboard",
  tags: ["Runs"],
  summary: "Rank runs by a metric",
  description: "Returns runs ranked by a metric aggregation (MIN, MAX, AVG, LAST, VARIANCE) using pre-computed metric summaries. Much faster than comparing individual runs. Useful for finding the best runs in a project by loss, accuracy, or any other metric.",
  security: [{ bearerAuth: [] }],
  request: {
    query: z.object({
      projectName: z.string().openapi({ description: "Project name" }),
      logName: z.string().openapi({ description: "Metric name to rank by (e.g., 'train/loss', 'eval/accuracy')" }),
      aggregation: z.enum(VALID_AGGREGATIONS).default("LAST").openapi({ description: "Aggregation type: MIN, MAX, AVG, LAST, VARIANCE (default: LAST)" }),
      direction: z.enum(["ASC", "DESC"]).default("ASC").openapi({ description: "Sort direction: ASC (lowest first) or DESC (highest first). Default: ASC" }),
      limit: z.coerce.number().optional().default(20).openapi({ description: "Number of runs to return (default: 20, max: 100)" }),
      offset: z.coerce.number().optional().default(0).openapi({ description: "Offset for pagination (default: 0)" }),
    }),
  },
  responses: {
    200: {
      description: "Ranked list of runs with metric values",
      content: {
        "application/json": {
          schema: z.object({
            projectName: z.string(),
            logName: z.string(),
            aggregation: z.string(),
            direction: z.string(),
            runs: z.array(z.object({
              rank: z.number().openapi({ description: "1-based rank position" }),
              runId: z.number(),
              runName: z.string(),
              status: z.string(),
              url: z.string().openapi({ description: "URL to view this run in the UI" }),
              value: z.number().openapi({ description: "The aggregated metric value used for ranking" }),
              config: z.any().nullable(),
              tags: z.array(z.string()),
              createdAt: z.string(),
            })),
            total: z.number().openapi({ description: "Total number of runs that have this metric" }),
          }).openapi("LeaderboardResponse"),
        },
      },
    },
  },
});

router.use(leaderboardRoute.path, withApiKey);
router.openapi(leaderboardRoute, async (c) => {
  const apiKey = c.get("apiKey");
  const prisma = c.get("prisma");
  const { projectName, logName, aggregation, direction, limit: rawLimit, offset } = c.req.valid("query");

  const limit = Math.min(rawLimit, 100);

  // Fetch candidate run IDs from PostgreSQL first to ensure consistency
  // between PG and ClickHouse (runs may be deleted from PG but still exist in CH)
  const projectRuns = await prisma.runs.findMany({
    where: {
      organizationId: apiKey.organization.id,
      project: { name: projectName },
    },
    select: { id: true },
  });
  const candidateRunIds = projectRuns.map((r) => Number(r.id));

  if (candidateRunIds.length === 0) {
    return c.json({
      projectName,
      logName,
      aggregation,
      direction,
      runs: [],
      total: 0,
    }, 200);
  }

  // Get total count of runs with this metric (for pagination), scoped to valid PG runs
  const countQuery = `
    SELECT count(DISTINCT runId) as total
    FROM mlop_metric_summaries
    WHERE tenantId = {tenantId: String}
      AND projectName = {projectName: String}
      AND logName = {logName: String}
      AND runId IN ({candidateRunIds: Array(UInt64)})
  `;
  const countResult = await clickhouse.query(countQuery, {
    tenantId: apiKey.organization.id,
    projectName,
    logName,
    candidateRunIds,
  });
  const countData = (await countResult.json()) as Array<{ total: string }>;
  const total = Number(countData[0]?.total || 0);

  if (total === 0) {
    return c.json({
      projectName,
      logName,
      aggregation,
      direction,
      runs: [],
      total: 0,
    }, 200);
  }

  // Query ClickHouse for sorted run IDs using pre-computed summaries, scoped to valid PG runs
  const sortedRuns = await queryMetricSortedRunIds(clickhouse, {
    organizationId: apiKey.organization.id,
    projectName,
    sortLogName: logName,
    sortAggregation: aggregation as MetricAggregation,
    sortDirection: direction,
    limit,
    offset,
    candidateRunIds,
  });

  if (sortedRuns.length === 0) {
    return c.json({
      projectName,
      logName,
      aggregation,
      direction,
      runs: [],
      total,
    }, 200);
  }

  // Fetch run metadata from PostgreSQL
  const runIds = sortedRuns.map((r) => r.runId);
  const runs = await prisma.runs.findMany({
    where: {
      id: { in: runIds },
    },
    select: {
      id: true,
      name: true,
      status: true,
      config: true,
      tags: true,
      createdAt: true,
    },
  });

  // Build a map for quick lookup
  const runMap = new Map(runs.map((r) => [Number(r.id), r]));

  // Combine and preserve ClickHouse sort order
  const rankedRuns = sortedRuns
    .map((sr, idx) => {
      const run = runMap.get(sr.runId);
      if (!run) return null;
      return {
        rank: offset + idx + 1,
        runId: Number(run.id),
        runName: run.name,
        status: run.status,
        url: `${env.BETTER_AUTH_URL}/o/${apiKey.organization.slug}/projects/${encodeURIComponent(projectName)}/${sqidEncode(Number(run.id))}`,
        value: sr.sortValue,
        config: run.config,
        tags: run.tags,
        createdAt: run.createdAt.toISOString(),
      };
    })
    .filter((r) => r !== null);

  return c.json({
    projectName,
    logName,
    aggregation,
    direction,
    runs: rankedRuns,
    total,
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
