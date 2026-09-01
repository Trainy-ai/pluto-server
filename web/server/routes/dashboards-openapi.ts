import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { OrganizationRole, Prisma } from "@prisma/client";
import { withApiKey } from "./middleware";
import { env } from "../lib/env";
import {
  DashboardViewConfigSchema,
  createEmptyDashboardConfig,
  type Section,
} from "../lib/dashboard-types";
import {
  createDashboardView,
  DashboardViewServiceError,
  getDashboardViewVersion,
  listDashboardViewVersions,
  restoreDashboardViewVersion,
  updateDashboardView,
} from "../lib/dashboard-view-service";
import type { prisma } from "../lib/prisma";
import type { ApiKey, Organization, User } from "@prisma/client";

// Type for API key with relations
type ApiKeyWithRelations = ApiKey & {
  organization: Pick<Organization, "id" | "slug">;
  user: Pick<User, "id">;
};

type Env = {
  Variables: {
    prisma: typeof prisma;
    apiKey: ApiKeyWithRelations;
  };
};

const router = new OpenAPIHono<Env>();

const ErrorSchema = z
  .object({
    error: z.string(),
  })
  .openapi("Error");

/**
 * Resolve the acting user's role in the organization the API key belongs to.
 *
 * The tRPC dashboard procedures gate on `ctx.member.role`; this is the
 * API-key equivalent. A missing Member row means the key's user was removed
 * from the org after the key was minted — fall back to the least-privileged
 * role rather than assuming admin.
 */
const resolveOrgRole = async (
  db: typeof prisma,
  organizationId: string,
  userId: string,
): Promise<OrganizationRole> => {
  const member = await db.member.findFirst({
    where: { organizationId, userId },
    select: { role: true },
  });
  return member?.role ?? OrganizationRole.MEMBER;
};

/**
 * Count widgets across a config's sections, including one level of children.
 *
 * Dynamic sections are regenerated from `dynamicPattern` at render time and
 * hold no widgets on disk, so a dynamic section legitimately reports 0 — the
 * `dynamicPattern` field on the summary is what tells a caller it is not empty.
 */
function countWidgets(sections: Section[]): number {
  return sections.reduce(
    (total, section) =>
      total +
      section.widgets.length +
      (section.children ? countWidgets(section.children) : 0),
    0,
  );
}

function dashboardUrl(
  orgSlug: string,
  projectName: string,
  viewId: string,
): string {
  return `${env.BETTER_AUTH_URL}/o/${orgSlug}/projects/${encodeURIComponent(projectName)}?chart=${viewId}`;
}

const SectionSummarySchema = z
  .object({
    id: z.string(),
    name: z.string(),
    widgetCount: z.number(),
    dynamicPattern: z.string().nullable(),
    childCount: z.number(),
  })
  .openapi("DashboardSectionSummary");

function summarizeSections(sections: Section[]) {
  return sections.map((section) => ({
    id: section.id,
    name: section.name,
    widgetCount: section.widgets.length,
    dynamicPattern: section.dynamicPattern ?? null,
    childCount: section.children?.length ?? 0,
  }));
}

const DashboardSummarySchema = z
  .object({
    id: z.string().openapi({ description: "Dashboard view ID" }),
    name: z.string().openapi({ description: "Dashboard name" }),
    isDefault: z.boolean().openapi({
      description: "Whether this is the project's default dashboard",
    }),
    currentVersion: z
      .number()
      .int()
      .positive()
      .openapi({ description: "Latest immutable dashboard version" }),
    configValid: z.boolean().openapi({
      description: "Whether the stored config matches the current schema",
    }),
    sectionCount: z
      .number()
      .openapi({ description: "Number of top-level sections" }),
    widgetCount: z
      .number()
      .openapi({ description: "Total widgets across all sections" }),
    sections: z
      .array(SectionSummarySchema)
      .openapi({ description: "Per-section summary" }),
    createdAt: z
      .string()
      .openapi({ description: "ISO-8601 creation timestamp" }),
    updatedAt: z
      .string()
      .openapi({ description: "ISO-8601 last-update timestamp" }),
    createdById: z
      .string()
      .openapi({ description: "ID of the user who created the dashboard" }),
    url: z
      .string()
      .openapi({ description: "Deep link to the dashboard in the web UI" }),
  })
  .openapi("DashboardSummary");

/**
 * Parse a stored config, tolerating rows written before a schema change.
 *
 * `list` must not fail wholesale because one legacy row no longer validates,
 * so callers get `null` for the unparseable ones and a usable list for the
 * rest. `details` handles the null case explicitly with a 422.
 */
function safeParseConfig(config: Prisma.JsonValue) {
  const result = DashboardViewConfigSchema.safeParse(config);
  return result.success ? result.data : null;
}

// ============= List Dashboards =============
const listDashboardsRoute = createRoute({
  method: "get",
  path: "/list",
  tags: ["Dashboards"],
  summary: "List dashboards for a project",
  description:
    "Returns dashboard views for a project with per-section summaries but WITHOUT the full widget config. Use /details/{viewId} to fetch a complete config.",
  security: [{ bearerAuth: [] }],
  request: {
    query: z.object({
      projectName: z
        .string()
        .openapi({ description: "Name of the project", example: "my-project" }),
    }),
  },
  responses: {
    200: {
      description: "Dashboards listed successfully",
      content: {
        "application/json": {
          schema: z
            .object({
              dashboards: z.array(DashboardSummarySchema),
            })
            .openapi("ListDashboardsResponse"),
        },
      },
    },
    401: {
      description: "Unauthorized",
      content: { "application/json": { schema: ErrorSchema } },
    },
    404: {
      description: "Project not found",
      content: { "application/json": { schema: ErrorSchema } },
    },
  },
});

router.use(listDashboardsRoute.path, withApiKey);
router.openapi(listDashboardsRoute, async (c) => {
  const apiKey = c.get("apiKey");
  const { projectName } = c.req.valid("query");

  const project = await c.get("prisma").projects.findUnique({
    where: {
      organizationId_name: {
        organizationId: apiKey.organization.id,
        name: projectName,
      },
    },
    select: { id: true },
  });

  if (!project) {
    return c.json({ error: "Project not found" }, 404);
  }

  const views = await c.get("prisma").dashboardView.findMany({
    where: { organizationId: apiKey.organization.id, projectId: project.id },
    orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }],
  });

  return c.json(
    {
      dashboards: views.map((view) => {
        const config = safeParseConfig(view.config);
        const sections = config?.sections ?? [];
        return {
          id: view.id.toString(),
          name: view.name,
          isDefault: view.isDefault,
          currentVersion: view.currentVersion,
          configValid: config !== null,
          sectionCount: sections.length,
          widgetCount: countWidgets(sections),
          sections: summarizeSections(sections),
          createdAt: view.createdAt.toISOString(),
          updatedAt: view.updatedAt.toISOString(),
          createdById: view.createdById,
          url: dashboardUrl(
            apiKey.organization.slug,
            projectName,
            view.id.toString(),
          ),
        };
      }),
    },
    200,
  );
});

// ============= Get Dashboard =============
const getDashboardRoute = createRoute({
  method: "get",
  path: "/details/{viewId}",
  tags: ["Dashboards"],
  summary: "Get a dashboard with its full config",
  description:
    "Returns a single dashboard view including the complete section/widget configuration.",
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({
      viewId: z
        .string()
        .openapi({ description: "Dashboard view ID", example: "12" }),
    }),
  },
  responses: {
    200: {
      description: "Dashboard fetched successfully",
      content: {
        "application/json": {
          schema: z
            .object({
              id: z.string(),
              name: z.string(),
              projectName: z.string(),
              isDefault: z.boolean(),
              currentVersion: z.number().int().positive(),
              config: z
                .record(z.unknown())
                .openapi({ description: "Full DashboardViewConfig" }),
              createdAt: z.string(),
              updatedAt: z.string(),
              createdById: z.string(),
              url: z.string(),
            })
            .openapi("DashboardDetailsResponse"),
        },
      },
    },
    401: {
      description: "Unauthorized",
      content: { "application/json": { schema: ErrorSchema } },
    },
    404: {
      description: "Dashboard not found",
      content: { "application/json": { schema: ErrorSchema } },
    },
    422: {
      description: "Stored config failed validation",
      content: { "application/json": { schema: ErrorSchema } },
    },
  },
});

router.use("/details/:viewId", withApiKey);
router.openapi(getDashboardRoute, async (c) => {
  const apiKey = c.get("apiKey");
  const { viewId } = c.req.valid("param");

  // A non-numeric viewId would make BigInt() throw and surface as a 500;
  // it is a client error, so reject it as a miss like any other bad ID.
  let id: bigint;
  try {
    id = BigInt(viewId);
  } catch {
    return c.json({ error: "Dashboard not found" }, 404);
  }

  const view = await c.get("prisma").dashboardView.findFirst({
    where: { id, organizationId: apiKey.organization.id },
    include: { project: { select: { name: true } } },
  });

  if (!view) {
    return c.json({ error: "Dashboard not found" }, 404);
  }

  const config = safeParseConfig(view.config);
  if (!config) {
    return c.json({ error: "Stored dashboard config failed validation" }, 422);
  }

  return c.json(
    {
      id: view.id.toString(),
      name: view.name,
      projectName: view.project.name,
      isDefault: view.isDefault,
      currentVersion: view.currentVersion,
      config: config as unknown as Record<string, unknown>,
      createdAt: view.createdAt.toISOString(),
      updatedAt: view.updatedAt.toISOString(),
      createdById: view.createdById,
      url: dashboardUrl(
        apiKey.organization.slug,
        view.project.name,
        view.id.toString(),
      ),
    },
    200,
  );
});

const DashboardVersionMetadataSchema = z
  .object({
    version: z.number().int().positive(),
    name: z.string(),
    source: z.string(),
    restoredFromVersion: z.number().int().positive().nullable(),
    createdAt: z.string(),
    createdBy: z
      .object({
        id: z.string(),
        name: z.string(),
        image: z.string().nullable(),
      })
      .nullable(),
    isCurrent: z.boolean(),
  })
  .openapi("DashboardVersionMetadata");

// ============= List Dashboard Versions =============
const listDashboardVersionsRoute = createRoute({
  method: "get",
  path: "/details/{viewId}/versions",
  tags: ["Dashboards"],
  summary: "List immutable dashboard versions",
  description:
    "Returns newest-first version metadata without the full dashboard config.",
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({ viewId: z.string() }),
    query: z.object({
      limit: z.coerce.number().int().min(1).max(100).optional().default(50),
      beforeVersion: z.coerce.number().int().positive().optional(),
    }),
  },
  responses: {
    200: {
      description: "Dashboard versions listed successfully",
      content: {
        "application/json": {
          schema: z
            .object({
              currentVersion: z.number().int().positive(),
              versions: z.array(DashboardVersionMetadataSchema),
              nextCursor: z.number().int().positive().nullable(),
            })
            .openapi("ListDashboardVersionsResponse"),
        },
      },
    },
    401: {
      description: "Unauthorized",
      content: { "application/json": { schema: ErrorSchema } },
    },
    404: {
      description: "Dashboard not found",
      content: { "application/json": { schema: ErrorSchema } },
    },
  },
});

router.use("/details/:viewId/versions", withApiKey);
router.openapi(listDashboardVersionsRoute, async (c) => {
  const apiKey = c.get("apiKey");
  const { viewId } = c.req.valid("param");
  const { limit, beforeVersion } = c.req.valid("query");

  let id: bigint;
  try {
    id = BigInt(viewId);
  } catch {
    return c.json({ error: "Dashboard not found" }, 404);
  }

  let history;
  try {
    history = await listDashboardViewVersions(c.get("prisma"), {
      organizationId: apiKey.organization.id,
      viewId: id,
      limit,
      beforeVersion,
    });
  } catch (error) {
    if (
      error instanceof DashboardViewServiceError &&
      error.code === "NOT_FOUND"
    ) {
      return c.json({ error: error.message }, 404);
    }
    throw error;
  }

  return c.json(
    {
      currentVersion: history.currentVersion,
      versions: history.versions.map((snapshot) => ({
        version: snapshot.version,
        name: snapshot.name,
        source: snapshot.source,
        restoredFromVersion: snapshot.restoredFromVersion,
        createdAt: snapshot.createdAt.toISOString(),
        createdBy: snapshot.createdBy,
        isCurrent: snapshot.isCurrent,
      })),
      nextCursor: history.nextCursor,
    },
    200,
  );
});

// ============= Get Dashboard Version =============
const getDashboardVersionRoute = createRoute({
  method: "get",
  path: "/details/{viewId}/versions/{version}",
  tags: ["Dashboards"],
  summary: "Get an immutable dashboard version",
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({
      viewId: z.string(),
      version: z.coerce.number().int().positive(),
    }),
  },
  responses: {
    200: {
      description: "Dashboard version fetched successfully",
      content: {
        "application/json": {
          schema: DashboardVersionMetadataSchema.extend({
            config: z.record(z.unknown()),
          }).openapi("DashboardVersionDetailsResponse"),
        },
      },
    },
    401: {
      description: "Unauthorized",
      content: { "application/json": { schema: ErrorSchema } },
    },
    404: {
      description: "Dashboard or version not found",
      content: { "application/json": { schema: ErrorSchema } },
    },
    422: {
      description: "Stored config failed validation",
      content: { "application/json": { schema: ErrorSchema } },
    },
  },
});

router.use("/details/:viewId/versions/:version", withApiKey);
router.openapi(getDashboardVersionRoute, async (c) => {
  const apiKey = c.get("apiKey");
  const { viewId, version } = c.req.valid("param");

  let id: bigint;
  try {
    id = BigInt(viewId);
  } catch {
    return c.json({ error: "Dashboard not found" }, 404);
  }

  let snapshot;
  try {
    snapshot = await getDashboardViewVersion(c.get("prisma"), {
      organizationId: apiKey.organization.id,
      viewId: id,
      version,
    });
  } catch (error) {
    if (error instanceof DashboardViewServiceError) {
      if (error.code === "NOT_FOUND") {
        return c.json({ error: error.message }, 404);
      }
      if (error.code === "INVALID_CONFIG") {
        return c.json({ error: error.message }, 422);
      }
    }
    throw error;
  }

  return c.json(
    {
      version: snapshot.version,
      name: snapshot.name,
      config: snapshot.config as unknown as Record<string, unknown>,
      source: snapshot.source,
      restoredFromVersion: snapshot.restoredFromVersion,
      createdAt: snapshot.createdAt.toISOString(),
      createdBy: snapshot.createdBy,
      isCurrent: snapshot.isCurrent,
    },
    200,
  );
});

// ============= Create Dashboard =============
const createDashboardRoute = createRoute({
  method: "post",
  path: "/create",
  tags: ["Dashboards"],
  summary: "Create a dashboard",
  description:
    "Creates a new dashboard view in a project. Names are unique per project. Only org admins/owners may set isDefault.",
  security: [{ bearerAuth: [] }],
  request: {
    body: {
      content: {
        "application/json": {
          schema: z
            .object({
              projectName: z.string().openapi({
                description: "Name of the project",
                example: "my-project",
              }),
              name: z.string().min(1).max(255).openapi({
                description: "Dashboard name",
                example: "Training Overview",
              }),
              config: DashboardViewConfigSchema.optional().openapi({
                type: "object",
                description:
                  "Full dashboard config. Defaults to an empty dashboard when omitted.",
              }),
              isDefault: z.boolean().optional().default(false).openapi({
                description:
                  "Make this the project's default dashboard (admins/owners only)",
              }),
            })
            .openapi("CreateDashboardRequest"),
        },
      },
    },
  },
  responses: {
    200: {
      description: "Dashboard created successfully",
      content: {
        "application/json": {
          schema: z
            .object({
              id: z.string(),
              name: z.string(),
              projectName: z.string(),
              isDefault: z.boolean(),
              currentVersion: z.number().int().positive(),
              sectionCount: z.number(),
              widgetCount: z.number(),
              createdAt: z.string(),
              updatedAt: z.string(),
              url: z.string(),
            })
            .openapi("CreateDashboardResponse"),
        },
      },
    },
    401: {
      description: "Unauthorized",
      content: { "application/json": { schema: ErrorSchema } },
    },
    400: {
      description: "Invalid request body or dashboard config",
      content: { "application/json": { schema: ErrorSchema } },
    },
    403: {
      description: "Forbidden",
      content: { "application/json": { schema: ErrorSchema } },
    },
    404: {
      description: "Project not found",
      content: { "application/json": { schema: ErrorSchema } },
    },
    409: {
      description: "A dashboard with this name already exists",
      content: { "application/json": { schema: ErrorSchema } },
    },
  },
});

router.use(createDashboardRoute.path, withApiKey);
router.openapi(createDashboardRoute, async (c) => {
  const apiKey = c.get("apiKey");
  const { projectName, name, config, isDefault } = c.req.valid("json");
  const db = c.get("prisma");

  const project = await db.projects.findUnique({
    where: {
      organizationId_name: {
        organizationId: apiKey.organization.id,
        name: projectName,
      },
    },
    select: { id: true },
  });

  if (!project) {
    return c.json({ error: "Project not found" }, 404);
  }

  const finalConfig = config ?? createEmptyDashboardConfig();

  let view;
  try {
    const role = await resolveOrgRole(
      db,
      apiKey.organization.id,
      apiKey.user.id,
    );
    view = await createDashboardView(db, {
      organizationId: apiKey.organization.id,
      projectId: project.id,
      actorId: apiKey.user.id,
      actorRole: role,
      name,
      config: finalConfig,
      isDefault,
      source: "api",
    });
  } catch (error) {
    if (error instanceof DashboardViewServiceError) {
      if (error.code === "NAME_CONFLICT") {
        return c.json({ error: error.message }, 409);
      }
      if (error.code === "DEFAULT_FORBIDDEN") {
        return c.json({ error: error.message }, 403);
      }
    }
    throw error;
  }

  return c.json(
    {
      id: view.id.toString(),
      name: view.name,
      projectName,
      isDefault: view.isDefault,
      currentVersion: view.currentVersion,
      sectionCount: finalConfig.sections.length,
      widgetCount: countWidgets(finalConfig.sections),
      createdAt: view.createdAt.toISOString(),
      updatedAt: view.updatedAt.toISOString(),
      url: dashboardUrl(
        apiKey.organization.slug,
        projectName,
        view.id.toString(),
      ),
    },
    200,
  );
});

// ============= Update Dashboard =============
const updateDashboardRoute = createRoute({
  method: "post",
  path: "/update",
  tags: ["Dashboards"],
  summary: "Update a dashboard",
  description:
    "Updates a dashboard's name, config, and/or default flag. Only the creator or an org admin/owner may modify a dashboard. A provided config REPLACES the stored one.",
  security: [{ bearerAuth: [] }],
  request: {
    body: {
      content: {
        "application/json": {
          schema: z
            .object({
              viewId: z
                .string()
                .openapi({ description: "Dashboard view ID", example: "12" }),
              name: z
                .string()
                .min(1)
                .max(255)
                .optional()
                .openapi({ description: "New dashboard name" }),
              config: DashboardViewConfigSchema.optional().openapi({
                type: "object",
                description:
                  "Replacement dashboard config (full replace, not a merge)",
              }),
              isDefault: z.boolean().optional().openapi({
                description:
                  "Make this the project's default dashboard (admins/owners only)",
              }),
              expectedUpdatedAt: z.string().datetime().optional().openapi({
                description:
                  "Optimistic-concurrency guard. When set, the update is rejected with 409 if the dashboard changed after this timestamp.",
              }),
            })
            .openapi("UpdateDashboardRequest"),
        },
      },
    },
  },
  responses: {
    200: {
      description: "Dashboard updated successfully",
      content: {
        "application/json": {
          schema: z
            .object({
              id: z.string(),
              name: z.string(),
              projectName: z.string(),
              isDefault: z.boolean(),
              currentVersion: z.number().int().positive(),
              sectionCount: z.number(),
              widgetCount: z.number(),
              updatedAt: z.string(),
              url: z.string(),
            })
            .openapi("UpdateDashboardResponse"),
        },
      },
    },
    401: {
      description: "Unauthorized",
      content: { "application/json": { schema: ErrorSchema } },
    },
    400: {
      description: "Invalid request body or dashboard config",
      content: { "application/json": { schema: ErrorSchema } },
    },
    403: {
      description: "Forbidden",
      content: { "application/json": { schema: ErrorSchema } },
    },
    404: {
      description: "Dashboard not found",
      content: { "application/json": { schema: ErrorSchema } },
    },
    409: {
      description:
        "Name conflict, or the dashboard changed since expectedUpdatedAt",
      content: { "application/json": { schema: ErrorSchema } },
    },
    422: {
      description: "Stored config failed validation",
      content: { "application/json": { schema: ErrorSchema } },
    },
  },
});

router.use(updateDashboardRoute.path, withApiKey);
router.openapi(updateDashboardRoute, async (c) => {
  const apiKey = c.get("apiKey");
  const { viewId, name, config, isDefault, expectedUpdatedAt } =
    c.req.valid("json");
  const db = c.get("prisma");

  let id: bigint;
  try {
    id = BigInt(viewId);
  } catch {
    return c.json({ error: "Dashboard not found" }, 404);
  }

  const role = await resolveOrgRole(db, apiKey.organization.id, apiKey.user.id);
  let updated;
  try {
    updated = await updateDashboardView(db, {
      organizationId: apiKey.organization.id,
      viewId: id,
      actorId: apiKey.user.id,
      actorRole: role,
      name,
      config,
      isDefault,
      expectedUpdatedAt: expectedUpdatedAt
        ? new Date(expectedUpdatedAt)
        : undefined,
      source: "api",
    });
  } catch (error) {
    if (error instanceof DashboardViewServiceError) {
      if (error.code === "NOT_FOUND") {
        return c.json({ error: error.message }, 404);
      }
      if (error.code === "FORBIDDEN" || error.code === "DEFAULT_FORBIDDEN") {
        return c.json({ error: error.message }, 403);
      }
      if (error.code === "CONFLICT" || error.code === "NAME_CONFLICT") {
        return c.json({ error: error.message }, 409);
      }
      if (error.code === "INVALID_CONFIG") {
        return c.json({ error: error.message }, 422);
      }
    }
    throw error;
  }

  const storedConfig = DashboardViewConfigSchema.parse(updated.config);

  return c.json(
    {
      id: updated.id.toString(),
      name: updated.name,
      projectName: updated.project.name,
      isDefault: updated.isDefault,
      currentVersion: updated.currentVersion,
      sectionCount: storedConfig.sections.length,
      widgetCount: countWidgets(storedConfig.sections),
      updatedAt: updated.updatedAt.toISOString(),
      url: dashboardUrl(
        apiKey.organization.slug,
        updated.project.name,
        updated.id.toString(),
      ),
    },
    200,
  );
});

// ============= Restore Dashboard Version =============
const restoreDashboardVersionRoute = createRoute({
  method: "post",
  path: "/restore",
  tags: ["Dashboards"],
  summary: "Restore a historical dashboard version",
  description:
    "Copies a historical name/config snapshot into the dashboard and appends a new immutable head version.",
  security: [{ bearerAuth: [] }],
  request: {
    body: {
      content: {
        "application/json": {
          schema: z
            .object({
              viewId: z.string(),
              version: z.number().int().positive(),
              expectedUpdatedAt: z.string().datetime().openapi({
                description:
                  "Optimistic-concurrency guard from the current dashboard details response",
              }),
            })
            .openapi("RestoreDashboardVersionRequest"),
        },
      },
    },
  },
  responses: {
    200: {
      description: "Dashboard version restored as a new current version",
      content: {
        "application/json": {
          schema: z
            .object({
              id: z.string(),
              name: z.string(),
              projectName: z.string(),
              isDefault: z.boolean(),
              currentVersion: z.number().int().positive(),
              restoredFromVersion: z.number().int().positive(),
              config: z.record(z.unknown()),
              updatedAt: z.string(),
              url: z.string(),
            })
            .openapi("RestoreDashboardVersionResponse"),
        },
      },
    },
    400: {
      description: "The selected version is already current",
      content: { "application/json": { schema: ErrorSchema } },
    },
    401: {
      description: "Unauthorized",
      content: { "application/json": { schema: ErrorSchema } },
    },
    403: {
      description: "Forbidden",
      content: { "application/json": { schema: ErrorSchema } },
    },
    404: {
      description: "Dashboard or version not found",
      content: { "application/json": { schema: ErrorSchema } },
    },
    409: {
      description: "Name conflict or stale expectedUpdatedAt",
      content: { "application/json": { schema: ErrorSchema } },
    },
    422: {
      description: "Stored version config failed validation",
      content: { "application/json": { schema: ErrorSchema } },
    },
  },
});

router.use(restoreDashboardVersionRoute.path, withApiKey);
router.openapi(restoreDashboardVersionRoute, async (c) => {
  const apiKey = c.get("apiKey");
  const { viewId, version, expectedUpdatedAt } = c.req.valid("json");

  let id: bigint;
  try {
    id = BigInt(viewId);
  } catch {
    return c.json({ error: "Dashboard not found" }, 404);
  }

  const db = c.get("prisma");
  const role = await resolveOrgRole(db, apiKey.organization.id, apiKey.user.id);
  let restored;
  try {
    restored = await restoreDashboardViewVersion(db, {
      organizationId: apiKey.organization.id,
      viewId: id,
      version,
      actorId: apiKey.user.id,
      actorRole: role,
      expectedUpdatedAt: new Date(expectedUpdatedAt),
    });
  } catch (error) {
    if (error instanceof DashboardViewServiceError) {
      if (error.code === "CURRENT_VERSION") {
        return c.json({ error: error.message }, 400);
      }
      if (error.code === "NOT_FOUND") {
        return c.json({ error: error.message }, 404);
      }
      if (error.code === "FORBIDDEN" || error.code === "DEFAULT_FORBIDDEN") {
        return c.json({ error: error.message }, 403);
      }
      if (error.code === "CONFLICT" || error.code === "NAME_CONFLICT") {
        return c.json({ error: error.message }, 409);
      }
      if (error.code === "INVALID_CONFIG") {
        return c.json({ error: error.message }, 422);
      }
    }
    throw error;
  }

  const restoredConfig = DashboardViewConfigSchema.parse(restored.config);
  return c.json(
    {
      id: restored.id.toString(),
      name: restored.name,
      projectName: restored.project.name,
      isDefault: restored.isDefault,
      currentVersion: restored.currentVersion,
      restoredFromVersion: version,
      config: restoredConfig as unknown as Record<string, unknown>,
      updatedAt: restored.updatedAt.toISOString(),
      url: dashboardUrl(
        apiKey.organization.slug,
        restored.project.name,
        restored.id.toString(),
      ),
    },
    200,
  );
});

export default router;
