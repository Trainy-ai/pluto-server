import {
  Prisma,
  type OrganizationRole,
  type PrismaClient,
} from "@prisma/client";
import {
  DashboardViewConfigSchema,
  type DashboardViewConfig,
} from "./dashboard-types";

export const DASHBOARD_VERSION_SOURCES = [
  "web",
  "api",
  "restore",
  "migration",
  "seed",
] as const;

export type DashboardVersionSource = (typeof DASHBOARD_VERSION_SOURCES)[number];
type DashboardWriteSource = Extract<DashboardVersionSource, "web" | "api">;

interface SeedDashboardViewUpsertInput {
  where: {
    organizationId_projectId_name: {
      organizationId: string;
      projectId: bigint;
      name: string;
    };
  };
  update: { config: unknown };
  create: {
    organizationId: string;
    projectId: bigint;
    name: string;
    createdById: string;
    isDefault: boolean;
    config: unknown;
  };
}

export type DashboardViewServiceErrorCode =
  | "NOT_FOUND"
  | "FORBIDDEN"
  | "DEFAULT_FORBIDDEN"
  | "CONFLICT"
  | "NAME_CONFLICT"
  | "INVALID_CONFIG"
  | "CURRENT_VERSION";

export class DashboardViewServiceError extends Error {
  constructor(
    public readonly code: DashboardViewServiceErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "DashboardViewServiceError";
  }
}

export const dashboardCreatorSelect = {
  id: true,
  name: true,
  image: true,
} satisfies Prisma.UserSelect;

function isPrismaErrorCode(error: unknown, code: string): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError && error.code === code
  );
}

async function runSerializable<T>(
  db: PrismaClient,
  operation: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await db.$transaction(operation, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (error) {
      if (!isPrismaErrorCode(error, "P2034") || attempt === 3) {
        throw error;
      }
    }
  }
  throw new Error("Serializable dashboard transaction exhausted retries");
}

function isAdminOrOwner(role: OrganizationRole): boolean {
  return role === "OWNER" || role === "ADMIN";
}

function configsEqual(
  left: DashboardViewConfig,
  right: DashboardViewConfig,
): boolean {
  return jsonValuesEqual(left, right);
}

function jsonValuesEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function parseStoredConfig(
  config: Prisma.JsonValue,
  errorMessage = "Stored dashboard config failed validation",
): DashboardViewConfig {
  const parsed = DashboardViewConfigSchema.safeParse(config);
  if (!parsed.success) {
    throw new DashboardViewServiceError("INVALID_CONFIG", errorMessage);
  }
  return parsed.data;
}

function assertCanModify(
  createdById: string,
  actorId: string,
  actorRole: OrganizationRole,
): void {
  if (createdById !== actorId && !isAdminOrOwner(actorRole)) {
    throw new DashboardViewServiceError(
      "FORBIDDEN",
      "You do not have permission to modify this dashboard",
    );
  }
}

function assertCanSetDefault(
  isDefault: boolean | undefined,
  actorRole: OrganizationRole,
): void {
  if (isDefault === true && !isAdminOrOwner(actorRole)) {
    throw new DashboardViewServiceError(
      "DEFAULT_FORBIDDEN",
      "Only administrators can set a dashboard as the default",
    );
  }
}

function assertExpectedUpdatedAt(actual: Date, expected?: Date): void {
  if (expected && actual.getTime() !== expected.getTime()) {
    throw new DashboardViewServiceError(
      "CONFLICT",
      "This dashboard has been modified since expectedUpdatedAt. Re-fetch it and retry.",
    );
  }
}

async function withNameConflict<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (isPrismaErrorCode(error, "P2002")) {
      throw new DashboardViewServiceError(
        "NAME_CONFLICT",
        "A dashboard with this name already exists",
      );
    }
    throw error;
  }
}

export async function createDashboardView(
  db: PrismaClient,
  input: {
    organizationId: string;
    projectId: bigint;
    actorId: string;
    actorRole: OrganizationRole;
    name: string;
    config: DashboardViewConfig;
    isDefault: boolean;
    source: DashboardWriteSource;
  },
) {
  assertCanSetDefault(input.isDefault, input.actorRole);

  return withNameConflict(() =>
    runSerializable(db, async (tx) => {
      if (input.isDefault) {
        await tx.dashboardView.updateMany({
          where: {
            organizationId: input.organizationId,
            projectId: input.projectId,
            isDefault: true,
          },
          data: { isDefault: false },
        });
      }

      const view = await tx.dashboardView.create({
        data: {
          name: input.name,
          organizationId: input.organizationId,
          projectId: input.projectId,
          createdById: input.actorId,
          isDefault: input.isDefault,
          config: input.config as unknown as Prisma.InputJsonValue,
          currentVersion: 1,
          versions: {
            create: {
              version: 1,
              name: input.name,
              config: input.config as unknown as Prisma.InputJsonValue,
              createdById: input.actorId,
              source: input.source,
            },
          },
        },
        include: { createdBy: { select: dashboardCreatorSelect } },
      });

      return view;
    }),
  );
}

/**
 * Idempotently seed a dashboard without bypassing the snapshot invariant.
 * Seed scripts use the same compound identity as DashboardView's unique key,
 * so a changed fixture is appended as a new immutable version.
 */
export async function upsertSeedDashboardView(
  db: PrismaClient,
  input: SeedDashboardViewUpsertInput,
) {
  const nextConfig = input.update.config as Prisma.InputJsonValue;

  return runSerializable(db, async (tx) => {
    const current = await tx.dashboardView.findUnique({ where: input.where });
    if (!current) {
      return tx.dashboardView.create({
        data: {
          ...input.create,
          config: nextConfig,
          currentVersion: 1,
          versions: {
            create: {
              version: 1,
              name: input.create.name,
              config: nextConfig,
              createdById: input.create.createdById,
              source: "seed",
            },
          },
        },
      });
    }

    const currentSnapshot = await tx.dashboardViewVersion.findUnique({
      where: {
        dashboardViewId_version: {
          dashboardViewId: current.id,
          version: current.currentVersion,
        },
      },
    });
    if (!currentSnapshot) {
      await tx.dashboardViewVersion.create({
        data: {
          dashboardViewId: current.id,
          version: current.currentVersion,
          name: current.name,
          config: current.config as Prisma.InputJsonValue,
          createdById: current.createdById,
          source: "seed",
        },
      });
    }

    if (jsonValuesEqual(nextConfig, current.config)) {
      return current;
    }

    const nextVersion = current.currentVersion + 1;
    return tx.dashboardView.update({
      where: { id: current.id },
      data: {
        config: nextConfig,
        currentVersion: nextVersion,
        versions: {
          create: {
            version: nextVersion,
            name: current.name,
            config: nextConfig,
            createdById: input.create.createdById,
            source: "seed",
          },
        },
      },
    });
  });
}

export async function updateDashboardView(
  db: PrismaClient,
  input: {
    organizationId: string;
    viewId: bigint;
    actorId: string;
    actorRole: OrganizationRole;
    name?: string;
    config?: DashboardViewConfig;
    isDefault?: boolean;
    expectedUpdatedAt?: Date;
    source: DashboardWriteSource;
  },
) {
  assertCanSetDefault(input.isDefault, input.actorRole);

  return withNameConflict(() =>
    runSerializable(db, async (tx) => {
      const current = await tx.dashboardView.findFirst({
        where: { id: input.viewId, organizationId: input.organizationId },
      });
      if (!current) {
        throw new DashboardViewServiceError("NOT_FOUND", "Dashboard not found");
      }

      assertCanModify(current.createdById, input.actorId, input.actorRole);
      assertExpectedUpdatedAt(current.updatedAt, input.expectedUpdatedAt);

      const storedConfig = DashboardViewConfigSchema.safeParse(current.config);
      if (!storedConfig.success && input.config === undefined) {
        throw new DashboardViewServiceError(
          "INVALID_CONFIG",
          "Stored dashboard config failed validation",
        );
      }
      const currentConfig = storedConfig.success ? storedConfig.data : null;
      const nextName = input.name ?? current.name;
      const nextConfig = input.config ?? currentConfig!;
      const contentChanged =
        nextName !== current.name ||
        currentConfig === null ||
        !configsEqual(nextConfig, currentConfig);
      const defaultChanged =
        input.isDefault !== undefined && input.isDefault !== current.isDefault;

      if (input.isDefault === true && defaultChanged) {
        await tx.dashboardView.updateMany({
          where: {
            organizationId: input.organizationId,
            projectId: current.projectId,
            isDefault: true,
            id: { not: current.id },
          },
          data: { isDefault: false },
        });
      }

      if (!contentChanged && !defaultChanged) {
        return tx.dashboardView.findUniqueOrThrow({
          where: { id: current.id },
          include: {
            createdBy: { select: dashboardCreatorSelect },
            project: { select: { name: true } },
          },
        });
      }

      const nextVersion = contentChanged
        ? current.currentVersion + 1
        : current.currentVersion;
      const updated = await tx.dashboardView.update({
        where: { id: current.id },
        data: {
          ...(nextName !== current.name && { name: nextName }),
          ...(input.config !== undefined &&
            (currentConfig === null ||
              !configsEqual(nextConfig, currentConfig)) && {
              config: nextConfig as unknown as Prisma.InputJsonValue,
            }),
          ...(defaultChanged && { isDefault: input.isDefault }),
          ...(contentChanged && { currentVersion: nextVersion }),
        },
        include: {
          createdBy: { select: dashboardCreatorSelect },
          project: { select: { name: true } },
        },
      });

      if (contentChanged) {
        await tx.dashboardViewVersion.create({
          data: {
            dashboardViewId: current.id,
            version: nextVersion,
            name: nextName,
            config: (input.config === undefined
              ? current.config
              : nextConfig) as Prisma.InputJsonValue,
            createdById: input.actorId,
            source: input.source,
          },
        });
      }

      return updated;
    }),
  );
}

export async function restoreDashboardViewVersion(
  db: PrismaClient,
  input: {
    organizationId: string;
    viewId: bigint;
    version: number;
    actorId: string;
    actorRole: OrganizationRole;
    expectedUpdatedAt: Date;
  },
) {
  return withNameConflict(() =>
    runSerializable(db, async (tx) => {
      const current = await tx.dashboardView.findFirst({
        where: { id: input.viewId, organizationId: input.organizationId },
      });
      if (!current) {
        throw new DashboardViewServiceError("NOT_FOUND", "Dashboard not found");
      }

      assertCanModify(current.createdById, input.actorId, input.actorRole);
      assertExpectedUpdatedAt(current.updatedAt, input.expectedUpdatedAt);

      if (input.version === current.currentVersion) {
        throw new DashboardViewServiceError(
          "CURRENT_VERSION",
          "The selected version is already current",
        );
      }

      const snapshot = await tx.dashboardViewVersion.findUnique({
        where: {
          dashboardViewId_version: {
            dashboardViewId: current.id,
            version: input.version,
          },
        },
      });
      if (!snapshot) {
        throw new DashboardViewServiceError(
          "NOT_FOUND",
          "Dashboard version not found",
        );
      }

      const restoredConfig = parseStoredConfig(snapshot.config);
      const nextVersion = current.currentVersion + 1;
      const updated = await tx.dashboardView.update({
        where: { id: current.id },
        data: {
          name: snapshot.name,
          config: restoredConfig as unknown as Prisma.InputJsonValue,
          currentVersion: nextVersion,
        },
        include: {
          createdBy: { select: dashboardCreatorSelect },
          project: { select: { name: true } },
        },
      });

      await tx.dashboardViewVersion.create({
        data: {
          dashboardViewId: current.id,
          version: nextVersion,
          name: snapshot.name,
          config: restoredConfig as unknown as Prisma.InputJsonValue,
          createdById: input.actorId,
          source: "restore",
          restoredFromVersion: snapshot.version,
        },
      });

      return updated;
    }),
  );
}

export async function listDashboardViewVersions(
  db: PrismaClient,
  input: {
    organizationId: string;
    viewId: bigint;
    limit: number;
    beforeVersion?: number;
  },
) {
  const view = await db.dashboardView.findFirst({
    where: { id: input.viewId, organizationId: input.organizationId },
    select: {
      currentVersion: true,
      versions: {
        where: input.beforeVersion
          ? { version: { lt: input.beforeVersion } }
          : undefined,
        orderBy: { version: "desc" },
        take: input.limit + 1,
        select: {
          version: true,
          name: true,
          source: true,
          restoredFromVersion: true,
          createdAt: true,
          createdBy: { select: dashboardCreatorSelect },
        },
      },
    },
  });
  if (!view) {
    throw new DashboardViewServiceError("NOT_FOUND", "Dashboard not found");
  }

  const hasMore = view.versions.length > input.limit;
  const versions = hasMore
    ? view.versions.slice(0, input.limit)
    : view.versions;

  return {
    currentVersion: view.currentVersion,
    versions: versions.map((version) => ({
      version: version.version,
      name: version.name,
      source: version.source,
      restoredFromVersion: version.restoredFromVersion,
      createdAt: version.createdAt,
      createdBy: version.createdBy,
      isCurrent: version.version === view.currentVersion,
    })),
    nextCursor: hasMore ? (versions.at(-1)?.version ?? null) : null,
  };
}

export async function getDashboardViewVersion(
  db: PrismaClient,
  input: {
    organizationId: string;
    viewId: bigint;
    version: number;
  },
) {
  const view = await db.dashboardView.findFirst({
    where: { id: input.viewId, organizationId: input.organizationId },
    select: {
      currentVersion: true,
      versions: {
        where: { version: input.version },
        take: 1,
        include: {
          createdBy: { select: dashboardCreatorSelect },
        },
      },
    },
  });
  if (!view) {
    throw new DashboardViewServiceError("NOT_FOUND", "Dashboard not found");
  }

  const snapshot = view.versions[0];
  if (!snapshot) {
    throw new DashboardViewServiceError(
      "NOT_FOUND",
      "Dashboard version not found",
    );
  }

  return {
    version: snapshot.version,
    name: snapshot.name,
    config: parseStoredConfig(
      snapshot.config,
      "Stored dashboard version config failed validation",
    ),
    source: snapshot.source,
    restoredFromVersion: snapshot.restoredFromVersion,
    createdAt: snapshot.createdAt,
    createdBy: snapshot.createdBy,
    isCurrent: snapshot.version === view.currentVersion,
  };
}
