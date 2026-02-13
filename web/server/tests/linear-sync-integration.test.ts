/**
 * Linear Sync Integration Tests
 *
 * Runs against a real Postgres instance to verify advisory locks, transactions,
 * and the full sync codepath work correctly. Skips gracefully when DATABASE_URL
 * is not available (local dev without Docker).
 *
 * Relies on the seeded test org/user from tests/setup.ts (pnpm test:setup).
 *
 * Run with: cd web && pnpm --filter @mlop/server test:smoke
 */

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { PrismaClient } from "@prisma/client";

// ---------------------------------------------------------------------------
// Mock only external HTTP / crypto deps — Prisma is REAL
// ---------------------------------------------------------------------------

vi.mock("../lib/linear-client", () => ({
  createComment: vi.fn(),
  updateComment: vi.fn(),
  getIssueByIdentifier: vi.fn(),
  getIssueComments: vi.fn(),
}));

vi.mock("../lib/linear-oauth", () => ({
  getValidToken: vi.fn().mockResolvedValue("mock-oauth-token"),
}));

vi.mock("../lib/sqid", () => ({
  sqidEncode: vi.fn((id: number) => `sqid_${id}`),
}));

vi.mock("../lib/env", () => ({
  env: { BETTER_AUTH_URL: "http://localhost:3000" },
}));

import { syncRunsToLinearIssue } from "../lib/linear-sync";
import { createComment, updateComment, getIssueByIdentifier, getIssueComments } from "../lib/linear-client";

// ---------------------------------------------------------------------------
// Skip entire suite when no DATABASE_URL (e.g. local dev without Docker)
// ---------------------------------------------------------------------------

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb("Linear Sync Integration (real Postgres)", () => {
  let prisma: PrismaClient;
  let orgId: string;
  let userId: string;
  let projectId: bigint;
  let apiKeyId: string;

  // Tag used to identify runs created by this test (for cleanup)
  const TEST_TAG = "linear:INTEGRATION-TEST-001";
  const TEST_ISSUE = "INTEGRATION-TEST-001";
  const TEST_PROJECT = "linear-sync-integ-test";

  beforeAll(async () => {
    prisma = new PrismaClient();

    // Look up seeded test org and user (created by tests/setup.ts)
    const org = await prisma.organization.findUnique({
      where: { slug: "smoke-test-org" },
    });
    if (!org) {
      throw new Error(
        "Test org 'smoke-test-org' not found — run pnpm test:setup first"
      );
    }
    orgId = org.id;

    const user = await prisma.user.findUnique({
      where: { email: "test-smoke@mlop.local" },
    });
    if (!user) {
      throw new Error(
        "Test user not found — run pnpm test:setup first"
      );
    }
    userId = user.id;

    // Look up the API key created by tests/setup.ts (required FK on Runs)
    const apiKey = await prisma.apiKey.findFirst({
      where: { organizationId: orgId, name: "Smoke Test Key" },
    });
    if (!apiKey) {
      throw new Error(
        "Test API key 'Smoke Test Key' not found — run pnpm test:setup first"
      );
    }
    apiKeyId = apiKey.id;

    // Create (or reuse) a dedicated project for this test suite
    const project = await prisma.projects.upsert({
      where: {
        organizationId_name: { organizationId: orgId, name: TEST_PROJECT },
      },
      create: { name: TEST_PROJECT, organizationId: orgId },
      update: {},
    });
    projectId = project.id;
  });

  afterAll(async () => {
    // Cleanup: delete integration, test runs, project (in FK order)
    await prisma.runs.deleteMany({
      where: { projectId, organizationId: orgId },
    });
    await prisma.integration.deleteMany({
      where: { organizationId: orgId, provider: "linear" },
    });
    await prisma.projects.deleteMany({
      where: { id: projectId },
    });
    await prisma.$disconnect();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // -----------------------------------------------------------------------
  // 1) Advisory lock primitive
  // -----------------------------------------------------------------------

  it("pg_advisory_xact_lock works via $executeRawUnsafe inside a transaction", async () => {
    // This is the exact call that broke in prod with $queryRawUnsafe.
    // If Prisma can't handle the void return, this throws.
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        `SELECT pg_advisory_xact_lock(hashtext($1))`,
        "integration-test-lock-key"
      );
    });
    // Reaching here without throwing = pass
  });

  it("advisory locks for different keys do not block each other", async () => {
    // Two concurrent transactions with different lock keys should both complete
    await Promise.all([
      prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(
          `SELECT pg_advisory_xact_lock(hashtext($1))`,
          "key-a"
        );
      }),
      prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(
          `SELECT pg_advisory_xact_lock(hashtext($1))`,
          "key-b"
        );
      }),
    ]);
  });

  // -----------------------------------------------------------------------
  // 2) Full sync against real Postgres
  // -----------------------------------------------------------------------

  it("creates a comment via the full sync codepath with real DB", async () => {
    // Setup: create integration + tagged run in real Postgres
    await prisma.integration.upsert({
      where: {
        organizationId_provider: { organizationId: orgId, provider: "linear" },
      },
      create: {
        organizationId: orgId,
        provider: "linear",
        enabled: true,
        encryptedToken: "test-enc-token",
        metadata: { commentIds: {} },
        createdById: userId,
      },
      update: {
        enabled: true,
        encryptedToken: "test-enc-token",
        metadata: { commentIds: {} },
      },
    });

    await prisma.runs.create({
      data: {
        name: "integ-run-1",
        organizationId: orgId,
        projectId,
        createdById: userId,
        creatorApiKeyId: apiKeyId,
        status: "COMPLETED",
        tags: [TEST_TAG],
      },
    });

    // Mock Linear API
    vi.mocked(getIssueByIdentifier).mockResolvedValue({
      id: "linear-issue-integ",
      identifier: TEST_ISSUE,
    });
    vi.mocked(getIssueComments).mockResolvedValue([]);
    vi.mocked(createComment).mockResolvedValue({ id: "new-comment-integ" });

    // Execute sync
    const result = await syncRunsToLinearIssue({
      prisma,
      organizationId: orgId,
      issueIdentifier: TEST_ISSUE,
    });

    expect(result.success).toBe(true);
    expect(createComment).toHaveBeenCalledOnce();

    // Verify comment ID was persisted to real DB
    const integration = await prisma.integration.findUnique({
      where: {
        organizationId_provider: { organizationId: orgId, provider: "linear" },
      },
    });
    const metadata = integration!.metadata as Record<string, any>;
    expect(metadata.commentIds[TEST_ISSUE]).toBe("new-comment-integ");
  });

  it("updates existing comment on second sync with real DB", async () => {
    // The previous test left a comment ID in metadata — this sync should update
    vi.mocked(getIssueByIdentifier).mockResolvedValue({
      id: "linear-issue-integ",
      identifier: TEST_ISSUE,
    });
    vi.mocked(updateComment).mockResolvedValue({ id: "new-comment-integ" });

    const result = await syncRunsToLinearIssue({
      prisma,
      organizationId: orgId,
      issueIdentifier: TEST_ISSUE,
    });

    expect(result.success).toBe(true);
    expect(updateComment).toHaveBeenCalledOnce();
    expect(createComment).not.toHaveBeenCalled();
  });

  it("handles concurrent syncs for the same issue without duplicate comments", async () => {
    // Reset metadata so both syncs start without a comment ID
    await prisma.integration.update({
      where: {
        organizationId_provider: { organizationId: orgId, provider: "linear" },
      },
      data: { metadata: { commentIds: {} } },
    });

    let callCount = 0;
    vi.mocked(getIssueByIdentifier).mockResolvedValue({
      id: "linear-issue-integ",
      identifier: TEST_ISSUE,
    });
    vi.mocked(getIssueComments).mockResolvedValue([]);
    vi.mocked(createComment).mockImplementation(async () => {
      callCount++;
      return { id: `comment-${callCount}` };
    });
    vi.mocked(updateComment).mockResolvedValue({ id: "comment-1" });

    const [r1, r2] = await Promise.all([
      syncRunsToLinearIssue({ prisma, organizationId: orgId, issueIdentifier: TEST_ISSUE }),
      syncRunsToLinearIssue({ prisma, organizationId: orgId, issueIdentifier: TEST_ISSUE }),
    ]);

    expect(r1.success).toBe(true);
    expect(r2.success).toBe(true);

    // First sync creates, second should see the stored comment ID and update
    expect(createComment).toHaveBeenCalledOnce();
    expect(updateComment).toHaveBeenCalledOnce();
  });
});
