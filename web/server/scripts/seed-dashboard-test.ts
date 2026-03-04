/**
 * Seed a custom dashboard view that tests the auto-hide feature for
 * empty pattern-matched chart widgets.
 *
 * Usage:
 *   cd web && pnpm exec tsx server/scripts/seed-dashboard-test.ts [project-name]
 *
 * Or via Docker:
 *   docker compose exec backend sh -c "cd /app && npx tsx server/scripts/seed-dashboard-test.ts [project-name]"
 *
 * If project-name is omitted, seeds ALL projects in the org.
 */

import { PrismaClient } from "@prisma/client";
import crypto from "crypto";

const prisma = new PrismaClient();

const DEV_ORG_SLUG = "dev-org";
const TARGET_PROJECT = process.argv[2]; // optional: seed a single project
const DASHBOARD_NAME = "Auto-Hide Test";

function generateId(): string {
  return crypto.randomUUID();
}

function chartWidget(
  title: string,
  metrics: string[],
  layout: { x: number; y: number; w: number; h: number },
) {
  return {
    id: generateId(),
    type: "chart" as const,
    config: {
      title,
      metrics,
      xAxis: "step",
      yAxisScale: "linear" as const,
      xAxisScale: "linear" as const,
      aggregation: "LAST" as const,
      showOriginal: false,
    },
    layout,
  };
}

function buildConfig() {
  return {
    version: 1,
    sections: [
      // ── Section 1: Patterns that MATCH metrics (should stay visible) ──
      // Uses broad patterns that match in most projects (train/*, sys/*, debug/*)
      {
        id: generateId(),
        name: "Matching Patterns (should be visible)",
        collapsed: false,
        widgets: [
          chartWidget("glob:train/* (matches train metrics)", ["glob:train/*"], { x: 0, y: 0, w: 4, h: 4 }),
          chartWidget("glob:sys/* (matches sys metrics)", ["glob:sys/*"], { x: 4, y: 0, w: 4, h: 4 }),
          chartWidget("regex:^(train|debug)/.* (matches train+debug)", ["regex:^(train|debug)/.*"], { x: 8, y: 0, w: 4, h: 4 }),
        ],
      },

      // ── Section 2: Patterns that DON'T match (should be auto-hidden) ──
      {
        id: generateId(),
        name: "Non-Matching Patterns (should be auto-hidden)",
        collapsed: false,
        widgets: [
          chartWidget("glob:validation/* (no match)", ["glob:validation/*"], { x: 0, y: 0, w: 4, h: 4 }),
          chartWidget("glob:nonexistent/* (no match)", ["glob:nonexistent/*"], { x: 4, y: 0, w: 4, h: 4 }),
          chartWidget("regex:^doesnotexist/.* (no match)", ["regex:^doesnotexist/.*"], { x: 8, y: 0, w: 4, h: 4 }),
          chartWidget("glob:gpu/* (no match)", ["glob:gpu/*"], { x: 0, y: 4, w: 4, h: 4 }),
        ],
      },

      // ── Section 3: Literal metrics (should always be visible) ──
      {
        id: generateId(),
        name: "Literal Metrics (always visible)",
        collapsed: false,
        widgets: [
          chartWidget("train/loss (literal)", ["train/loss"], { x: 0, y: 0, w: 6, h: 4 }),
          chartWidget("nonexistent/metric (literal, no data)", ["nonexistent/metric"], { x: 6, y: 0, w: 6, h: 4 }),
        ],
      },

      // ── Section 4: Mixed patterns + literals (never auto-hidden) ──
      {
        id: generateId(),
        name: "Mixed Pattern+Literal (never auto-hidden)",
        collapsed: false,
        widgets: [
          chartWidget("literal + non-matching glob", ["train/loss", "glob:nonexistent/*"], { x: 0, y: 0, w: 6, h: 4 }),
          chartWidget("matching glob + non-matching glob", ["glob:train/*", "glob:nonexistent/*"], { x: 6, y: 0, w: 6, h: 4 }),
        ],
      },
    ],
    settings: {
      gridCols: 12,
      rowHeight: 80,
      compactType: "vertical",
    },
  };
}

async function seedForProject(
  org: { id: string },
  project: { id: bigint; name: string },
  userId: string,
) {
  // Delete existing dashboard view with same name (idempotent)
  await prisma.dashboardView.deleteMany({
    where: {
      organizationId: org.id,
      projectId: project.id,
      name: DASHBOARD_NAME,
    },
  });

  const view = await prisma.dashboardView.create({
    data: {
      name: DASHBOARD_NAME,
      organizationId: org.id,
      projectId: project.id,
      createdById: userId,
      isDefault: false,
      config: buildConfig() as any,
    },
  });

  console.log(`  ✓ "${project.name}" → dashboard id ${view.id}`);
  return view;
}

async function main() {
  const org = await prisma.organization.findUnique({
    where: { slug: DEV_ORG_SLUG },
  });
  if (!org) throw new Error(`Organization '${DEV_ORG_SLUG}' not found. Run seed-dev first.`);

  const member = await prisma.member.findFirst({
    where: { organizationId: org.id },
  });
  if (!member) throw new Error("No org member found.");

  // Seed a single project or all projects in the org
  const projects = TARGET_PROJECT
    ? await prisma.projects.findMany({
        where: { organizationId: org.id, name: TARGET_PROJECT },
      })
    : await prisma.projects.findMany({
        where: { organizationId: org.id },
      });

  if (projects.length === 0) {
    throw new Error(
      TARGET_PROJECT
        ? `Project '${TARGET_PROJECT}' not found in '${DEV_ORG_SLUG}'.`
        : `No projects found in '${DEV_ORG_SLUG}'. Run seed-dev first.`,
    );
  }

  console.log(`Seeding "${DASHBOARD_NAME}" dashboard in ${projects.length} project(s):\n`);

  for (const project of projects) {
    await seedForProject(org, project, member.userId);
  }

  console.log(`\nTest plan:`);
  console.log(`  Section 1 — "Matching Patterns": 3 widgets with glob/regex that match real metrics → VISIBLE`);
  console.log(`  Section 2 — "Non-Matching Patterns": 4 widgets with patterns matching nothing → AUTO-HIDDEN`);
  console.log(`  Section 3 — "Literal Metrics": 2 widgets (one real, one nonexistent) → both VISIBLE`);
  console.log(`  Section 4 — "Mixed": 2 widgets mixing literal+pattern → both VISIBLE`);
  console.log(`\nTotal: 11 widgets. Expected visible in view mode: 7. Expected hidden: 4.`);
}

main()
  .catch((err) => {
    console.error("Failed to seed dashboard:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
