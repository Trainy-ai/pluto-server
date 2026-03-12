/**
 * One-off migration: reverse demo run timestamps so high-fidelity runs
 * (100k datapoints) appear as the "latest" runs in the UI.
 *
 * The original seed assigned oldest timestamps to low-index (high-fidelity)
 * runs. This script flips the order so those runs show up first.
 *
 * Usage:
 *   pnpm exec tsx scripts/fix-demo-timestamps.ts
 *
 * Safe to run multiple times — it's idempotent (always applies the same
 * reversed ordering).
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const DEV_ORG_SLUG = 'dev-org';
const DEV_PROJECT = 'my-ml-project';
const TOTAL_RUNS = 5000;

async function main() {
  const org = await prisma.organization.findUnique({
    where: { slug: DEV_ORG_SLUG },
  });
  if (!org) {
    console.error(`Organization "${DEV_ORG_SLUG}" not found.`);
    process.exit(1);
  }

  const project = await prisma.projects.findFirst({
    where: { name: DEV_PROJECT, organizationId: org.id },
  });
  if (!project) {
    console.error(`Project "${DEV_PROJECT}" not found.`);
    process.exit(1);
  }

  const allRuns = await prisma.runs.findMany({
    where: { projectId: project.id, organizationId: org.id },
    orderBy: { id: 'asc' },
    select: { id: true },
  });

  console.log(`Found ${allRuns.length} runs. Reversing timestamps...`);

  const baseDate = new Date(Date.now() - TOTAL_RUNS * 60 * 60 * 1000);

  for (let i = 0; i < allRuns.length; i++) {
    const reversedIndex = allRuns.length - 1 - i;
    const createdAt = new Date(baseDate.getTime() + reversedIndex * 60 * 60 * 1000);
    await prisma.$executeRaw`UPDATE "runs" SET "createdAt" = ${createdAt}, "updatedAt" = ${createdAt} WHERE id = ${allRuns[i].id}`;

    if ((i + 1) % 1000 === 0) {
      console.log(`  Updated ${i + 1}/${allRuns.length} timestamps...`);
    }
  }

  console.log(`Done. ${allRuns.length} run timestamps reversed.`);
  console.log(`High-fidelity runs (first 10 by ID) now have the newest timestamps.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
