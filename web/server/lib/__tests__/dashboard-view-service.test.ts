import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { upsertSeedDashboardView } from "../dashboard-view-service";

const originalConfig = { version: 1, sections: [{ id: "original" }] };
const replacementConfig = { version: 1, sections: [{ id: "replacement" }] };

function seedInput(config: unknown) {
  return {
    where: {
      organizationId_projectId_name: {
        organizationId: "org-1",
        projectId: 7n,
        name: "Seeded Dashboard",
      },
    },
    update: { config },
    create: {
      organizationId: "org-1",
      projectId: 7n,
      name: "Seeded Dashboard",
      createdById: "user-1",
      isDefault: false,
      config,
    },
  };
}

function mockDatabase(current: Record<string, unknown> | null) {
  const tx = {
    dashboardView: {
      create: vi.fn(async ({ data }) => data),
      findUnique: vi.fn(async () => current),
      update: vi.fn(async ({ data }) => data),
    },
    dashboardViewVersion: {
      create: vi.fn(async ({ data }) => data),
      findUnique: vi.fn(async () => null),
    },
  };
  const db = {
    $transaction: vi.fn(
      async (operation: (client: typeof tx) => Promise<unknown>) => operation(tx),
    ),
  } as unknown as PrismaClient;
  return { db, tx };
}

describe("upsertSeedDashboardView", () => {
  it("creates version one atomically for a new seeded dashboard", async () => {
    const { db, tx } = mockDatabase(null);

    await upsertSeedDashboardView(db, seedInput(originalConfig));

    expect(tx.dashboardView.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        currentVersion: 1,
        versions: {
          create: expect.objectContaining({
            version: 1,
            config: originalConfig,
            source: "seed",
          }),
        },
      }),
    });
  });

  it("repairs a missing head snapshot before appending a changed seed", async () => {
    const current = {
      id: 42n,
      currentVersion: 1,
      name: "Seeded Dashboard",
      config: originalConfig,
      createdById: "user-1",
    };
    const { db, tx } = mockDatabase(current);

    await upsertSeedDashboardView(db, seedInput(replacementConfig));

    expect(tx.dashboardViewVersion.create).toHaveBeenCalledWith({
      data: {
        dashboardViewId: 42n,
        version: 1,
        name: "Seeded Dashboard",
        config: originalConfig,
        createdById: "user-1",
        source: "seed",
      },
    });
    expect(tx.dashboardView.update).toHaveBeenCalledWith({
      where: { id: 42n },
      data: expect.objectContaining({
        currentVersion: 2,
        config: replacementConfig,
        versions: {
          create: expect.objectContaining({
            version: 2,
            config: replacementConfig,
            source: "seed",
          }),
        },
      }),
    });
  });
});
