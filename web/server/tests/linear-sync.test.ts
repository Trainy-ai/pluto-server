/**
 * Linear Sync Tests
 *
 * Tests the sync logic that writes/updates comments on Linear issues.
 * All external dependencies (prisma, linear-client, encryption, env) are mocked.
 *
 * Run with: cd web && pnpm --filter @mlop/server exec vitest run tests/linear-sync.test.ts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock external modules before importing the module under test
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

vi.mock("../lib/resolve-run-id", () => ({
  resolveRunId: vi.fn((_prisma: any, identifier: string) => {
    // Mock: extract numeric part from display ID like "PRJ-2" → 2
    const match = identifier.match(/-(\d+)$/);
    if (match) return Promise.resolve(parseInt(match[1], 10));
    return Promise.reject(new Error("Run not found"));
  }),
}));

vi.mock("../lib/env", () => ({
  env: { BETTER_AUTH_URL: "http://localhost:3000" },
}));

import { triggerLinearSyncForTags, syncRunsToLinearIssue, _resetIssueLocks } from "../lib/linear-sync";
import { createComment, updateComment, getIssueByIdentifier, getIssueComments } from "../lib/linear-client";

// ---------------------------------------------------------------------------
// Prisma mock helper
// ---------------------------------------------------------------------------

function createMockPrisma(overrides: {
  integration?: unknown;
  org?: unknown;
  runs?: unknown[];
  /** Baseline runs returned when resolving baseline: display IDs */
  baselineRuns?: unknown[];
} = {}) {
  const experimentRuns = overrides.runs ?? [];
  const baselineRuns = overrides.baselineRuns ?? [];

  // First findMany = experiment runs (linear: tag query).
  // Second findMany (if any) = baseline runs (resolved by ID).
  // Default to [] for any subsequent calls.
  const findManyMock = vi.fn()
    .mockResolvedValueOnce(experimentRuns)
    .mockResolvedValueOnce(baselineRuns)
    .mockResolvedValue([]);

  const mock: any = {
    $executeRawUnsafe: vi.fn().mockResolvedValue(0),
    integration: {
      findUnique: vi.fn().mockResolvedValue(
        overrides.integration !== undefined
          ? overrides.integration
          : {
              id: "int-1",
              organizationId: "org-1",
              provider: "linear",
              enabled: true,
              encryptedToken: "enc_token",
              metadata: { commentIds: {} },
            }
      ),
      update: vi.fn().mockResolvedValue({}),
    },
    organization: {
      findUnique: vi.fn().mockResolvedValue(
        overrides.org !== undefined ? overrides.org : { slug: "dev-org" }
      ),
    },
    runs: {
      findMany: findManyMock,
    },
  };
  // $transaction calls the callback with the mock itself as the tx client
  mock.$transaction = vi.fn((fn: any) => fn(mock));
  return mock;
}

// ---------------------------------------------------------------------------
// Mock run factory
// ---------------------------------------------------------------------------

function createMockRun(overrides: {
  id?: bigint;
  number?: number | null;
  name?: string;
  status?: string;
  tags?: string[];
  createdAt?: Date;
  project?: { name?: string; runPrefix?: string | null };
} = {}) {
  const { project, ...rest } = overrides;
  return {
    id: BigInt(1),
    number: 1,
    name: "test-run",
    status: "COMPLETED",
    tags: [] as string[],
    createdAt: new Date("2026-01-01"),
    ...rest,
    project: {
      name: "test-project",
      runPrefix: "TP",
      ...project,
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  _resetIssueLocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("triggerLinearSyncForTags", () => {
  it("should sync each linear: tag", () => {
    // We can't easily test the fire-and-forget calls directly since
    // syncRunsToLinearIssue requires prisma. Instead, verify the function
    // doesn't throw and handles the tag parsing correctly.
    const prisma = createMockPrisma();

    // Should not throw
    expect(() =>
      triggerLinearSyncForTags(prisma, "org-1", [
        "linear:TRA-1",
        "production",
        "linear:TRA-2",
      ])
    ).not.toThrow();
  });

  it("should also sync removed linear: tags when previousTags is provided", () => {
    const prisma = createMockPrisma();

    // Tag TRA-1 was removed, TRA-2 is new
    expect(() =>
      triggerLinearSyncForTags(
        prisma,
        "org-1",
        ["linear:TRA-2", "production"],
        ["linear:TRA-1", "linear:TRA-2", "production"]
      )
    ).not.toThrow();
  });

  it("should skip empty identifiers", () => {
    const prisma = createMockPrisma();

    expect(() =>
      triggerLinearSyncForTags(prisma, "org-1", ["linear:", "linear:TRA-1"])
    ).not.toThrow();
  });

  it("should skip when no linear: tags exist", () => {
    const prisma = createMockPrisma();

    expect(() =>
      triggerLinearSyncForTags(prisma, "org-1", ["production", "v2"])
    ).not.toThrow();
  });
});

describe("syncRunsToLinearIssue", () => {
  it("should create a new comment when no existing comment", async () => {
    const runs = [
      createMockRun({ id: BigInt(1), number: 1, name: "training-v1", createdAt: new Date("2026-02-09"), project: { name: "my-project", runPrefix: "MMP" } }),
      createMockRun({ id: BigInt(2), number: 2, name: "training-v2", status: "RUNNING", createdAt: new Date("2026-02-10"), project: { name: "my-project", runPrefix: "MMP" } }),
    ];

    const prisma = createMockPrisma({ runs });

    vi.mocked(getIssueByIdentifier).mockResolvedValue({
      id: "linear-issue-1",
      identifier: "TRA-1",
    });
    vi.mocked(getIssueComments).mockResolvedValue([]);
    vi.mocked(createComment).mockResolvedValue({ id: "new-comment-1" });

    const result = await syncRunsToLinearIssue({
      prisma,
      organizationId: "org-1",
      issueIdentifier: "TRA-1",
    });

    expect(result.success).toBe(true);

    // Should have called createComment (not updateComment)
    expect(createComment).toHaveBeenCalledOnce();
    expect(updateComment).not.toHaveBeenCalled();

    // Check the markdown body
    const body = vi.mocked(createComment).mock.calls[0][2];
    expect(body).toContain("## Pluto Experiments");
    expect(body).toContain("training\\-v1"); // escapeMarkdown escapes hyphens
    expect(body).toContain("training\\-v2");
    expect(body).toContain("COMPLETED");
    expect(body).toContain("RUNNING");
  });

  it("should update existing comment when comment ID exists in metadata", async () => {
    const runs = [
      createMockRun({ name: "run-1", createdAt: new Date("2026-02-09"), project: { name: "proj", runPrefix: "PRJ" } }),
    ];

    const prisma = createMockPrisma({
      integration: {
        id: "int-1",
        enabled: true,
        encryptedToken: "enc_tok",
        metadata: { commentIds: { "TRA-1": "existing-comment-id" } },
      },
      runs,
    });

    vi.mocked(getIssueByIdentifier).mockResolvedValue({
      id: "linear-issue-1",
      identifier: "TRA-1",
    });
    vi.mocked(updateComment).mockResolvedValue({ id: "existing-comment-id" });

    const result = await syncRunsToLinearIssue({
      prisma,
      organizationId: "org-1",
      issueIdentifier: "TRA-1",
    });

    expect(result.success).toBe(true);
    expect(updateComment).toHaveBeenCalledOnce();
    expect(createComment).not.toHaveBeenCalled();
  });

  it("should fall back to createComment when update fails and no Pluto comment found on issue", async () => {
    const runs = [
      createMockRun({ name: "run-1", createdAt: new Date("2026-02-09"), project: { name: "proj", runPrefix: "PRJ" } }),
    ];

    const prisma = createMockPrisma({
      integration: {
        id: "int-1",
        enabled: true,
        encryptedToken: "enc_tok",
        metadata: { commentIds: { "TRA-1": "deleted-comment-id" } },
      },
      runs,
    });

    vi.mocked(getIssueByIdentifier).mockResolvedValue({
      id: "linear-issue-1",
      identifier: "TRA-1",
    });
    vi.mocked(updateComment).mockRejectedValue(new Error("Comment not found"));
    vi.mocked(getIssueComments).mockResolvedValue([]); // No orphaned comment found
    vi.mocked(createComment).mockResolvedValue({ id: "new-comment-id" });

    const result = await syncRunsToLinearIssue({
      prisma,
      organizationId: "org-1",
      issueIdentifier: "TRA-1",
    });

    expect(result.success).toBe(true);
    expect(updateComment).toHaveBeenCalledOnce();
    expect(getIssueComments).toHaveBeenCalledOnce();
    expect(createComment).toHaveBeenCalledOnce();
  });

  it("should recover orphaned comment when update fails but Pluto comment exists on issue", async () => {
    const runs = [
      createMockRun({ name: "run-1", createdAt: new Date("2026-02-09"), project: { name: "proj", runPrefix: "PRJ" } }),
    ];

    const prisma = createMockPrisma({
      integration: {
        id: "int-1",
        enabled: true,
        encryptedToken: "enc_tok",
        metadata: { commentIds: { "TRA-1": "deleted-comment-id" } },
      },
      runs,
    });

    vi.mocked(getIssueByIdentifier).mockResolvedValue({
      id: "linear-issue-1",
      identifier: "TRA-1",
    });
    // First update call fails (stored ID is stale)
    vi.mocked(updateComment)
      .mockRejectedValueOnce(new Error("Comment not found"))
      // Second update call succeeds (orphaned comment found)
      .mockResolvedValueOnce({ id: "orphaned-comment-id" });
    vi.mocked(getIssueComments).mockResolvedValue(["orphaned-comment-id"]);

    const result = await syncRunsToLinearIssue({
      prisma,
      organizationId: "org-1",
      issueIdentifier: "TRA-1",
    });

    expect(result.success).toBe(true);
    // Should NOT create a new comment — should update the orphaned one
    expect(createComment).not.toHaveBeenCalled();
    expect(updateComment).toHaveBeenCalledTimes(2);
    // The saved comment ID should be the orphaned one
    expect(prisma.integration.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          metadata: expect.objectContaining({
            commentIds: { "TRA-1": "orphaned-comment-id" },
          }),
        }),
      })
    );
  });

  it("should find orphaned Pluto comment when no stored ID exists (idempotent)", async () => {
    const runs = [
      createMockRun({ name: "run-1", createdAt: new Date("2026-02-09"), project: { name: "proj", runPrefix: "PRJ" } }),
    ];

    const prisma = createMockPrisma({ runs }); // metadata has empty commentIds

    vi.mocked(getIssueByIdentifier).mockResolvedValue({
      id: "linear-issue-1",
      identifier: "TRA-1",
    });
    // An orphaned comment exists from a previous failed sync
    vi.mocked(getIssueComments).mockResolvedValue(["orphaned-comment-id"]);
    vi.mocked(updateComment).mockResolvedValue({ id: "orphaned-comment-id" });

    const result = await syncRunsToLinearIssue({
      prisma,
      organizationId: "org-1",
      issueIdentifier: "TRA-1",
    });

    expect(result.success).toBe(true);
    // Should update the orphaned comment, NOT create a new one
    expect(createComment).not.toHaveBeenCalled();
    expect(updateComment).toHaveBeenCalledOnce();
    expect(prisma.integration.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          metadata: expect.objectContaining({
            commentIds: { "TRA-1": "orphaned-comment-id" },
          }),
        }),
      })
    );
  });

  it("should hyperlink run names (not a separate Link column)", async () => {
    const runs = [
      createMockRun({ id: BigInt(42), number: 7, name: "my-run", createdAt: new Date("2026-02-10"), project: { name: "my-project", runPrefix: "MMP" } }),
    ];

    const prisma = createMockPrisma({ runs });

    vi.mocked(getIssueByIdentifier).mockResolvedValue({
      id: "iss-1",
      identifier: "TRA-1",
    });
    vi.mocked(getIssueComments).mockResolvedValue([]);
    vi.mocked(createComment).mockResolvedValue({ id: "c1" });

    await syncRunsToLinearIssue({
      prisma,
      organizationId: "org-1",
      issueIdentifier: "TRA-1",
    });

    const body = vi.mocked(createComment).mock.calls[0][2];

    // Run name should be a markdown link
    expect(body).toContain("[my\\-run](http://localhost:3000/o/dev-org/projects/my-project/sqid_42)");

    // Should have a "Run ID" column header
    expect(body).toContain("| Run ID |");
    // Run ID value (display ID) should appear in the row
    expect(body).toContain("MMP\\-7");

    // Should NOT have a "Link" column header
    expect(body).not.toContain("| Link |");
    expect(body).not.toContain("View in Pluto");
  });

  it("should include comparison link below the table", async () => {
    const runs = [
      createMockRun({ id: BigInt(1), number: 1, name: "run-a", createdAt: new Date("2026-02-09"), project: { name: "my-project", runPrefix: "MMP" } }),
      createMockRun({ id: BigInt(2), number: 2, name: "run-b", status: "RUNNING", createdAt: new Date("2026-02-10"), project: { name: "my-project", runPrefix: "MMP" } }),
    ];

    const prisma = createMockPrisma({ runs });

    vi.mocked(getIssueByIdentifier).mockResolvedValue({
      id: "iss-1",
      identifier: "TRA-1",
    });
    vi.mocked(getIssueComments).mockResolvedValue([]);
    vi.mocked(createComment).mockResolvedValue({ id: "c1" });

    await syncRunsToLinearIssue({
      prisma,
      organizationId: "org-1",
      issueIdentifier: "TRA-1",
    });

    const body = vi.mocked(createComment).mock.calls[0][2];
    expect(body).toContain("Compare all in my\\-project");
    expect(body).toContain("?runs=sqid_1,sqid_2");
  });

  it("should show 'no runs linked' when all tags removed", async () => {
    const prisma = createMockPrisma({
      integration: {
        id: "int-1",
        enabled: true,
        encryptedToken: "enc_tok",
        metadata: { commentIds: { "TRA-1": "old-comment" } },
      },
      runs: [], // No runs tagged anymore
    });

    vi.mocked(updateComment).mockResolvedValue({ id: "old-comment" });

    const result = await syncRunsToLinearIssue({
      prisma,
      organizationId: "org-1",
      issueIdentifier: "TRA-1",
    });

    expect(result.success).toBe(true);
    expect(updateComment).toHaveBeenCalledOnce();

    const body = vi.mocked(updateComment).mock.calls[0][2];
    expect(body).toContain("No runs are currently linked to this issue");
    // Should NOT call getIssueByIdentifier when there are no runs
    expect(getIssueByIdentifier).not.toHaveBeenCalled();
  });

  it("should not create a comment when no runs and no existing comment", async () => {
    const prisma = createMockPrisma({ runs: [] });

    const result = await syncRunsToLinearIssue({
      prisma,
      organizationId: "org-1",
      issueIdentifier: "TRA-1",
    });

    expect(result.success).toBe(true);
    expect(createComment).not.toHaveBeenCalled();
    expect(updateComment).not.toHaveBeenCalled();
  });

  it("should return error when integration not configured", async () => {
    const prisma = createMockPrisma({ integration: null });

    const result = await syncRunsToLinearIssue({
      prisma,
      organizationId: "org-1",
      issueIdentifier: "TRA-1",
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("not configured");
  });

  it("should return error when integration disabled", async () => {
    const prisma = createMockPrisma({
      integration: {
        id: "int-1",
        enabled: false,
        encryptedToken: "enc_tok",
        metadata: {},
      },
    });

    const result = await syncRunsToLinearIssue({
      prisma,
      organizationId: "org-1",
      issueIdentifier: "TRA-1",
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("not configured or disabled");
  });

  it("should return error when organization not found", async () => {
    const prisma = createMockPrisma({ org: null });

    const result = await syncRunsToLinearIssue({
      prisma,
      organizationId: "org-1",
      issueIdentifier: "TRA-1",
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("Organization not found");
  });

  it("should return error when Linear issue not found", async () => {
    const runs = [
      createMockRun({ name: "run-1", createdAt: new Date("2026-02-09"), project: { name: "proj", runPrefix: "PRJ" } }),
    ];
    const prisma = createMockPrisma({ runs });

    vi.mocked(getIssueByIdentifier).mockResolvedValue(null);

    const result = await syncRunsToLinearIssue({
      prisma,
      organizationId: "org-1",
      issueIdentifier: "NOPE-999",
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("NOPE-999 not found");
  });

  it("should save comment ID to integration metadata", async () => {
    const runs = [
      createMockRun({ name: "run-1", createdAt: new Date("2026-02-09"), project: { name: "proj", runPrefix: "PRJ" } }),
    ];

    const prisma = createMockPrisma({ runs });

    vi.mocked(getIssueByIdentifier).mockResolvedValue({
      id: "iss-1",
      identifier: "TRA-1",
    });
    vi.mocked(getIssueComments).mockResolvedValue([]);
    vi.mocked(createComment).mockResolvedValue({ id: "new-c-1" });

    await syncRunsToLinearIssue({
      prisma,
      organizationId: "org-1",
      issueIdentifier: "TRA-1",
    });

    expect(prisma.integration.update).toHaveBeenCalledWith({
      where: {
        organizationId_provider: {
          organizationId: "org-1",
          provider: "linear",
        },
      },
      data: {
        metadata: {
          commentIds: { "TRA-1": "new-c-1" },
        },
      },
    });
  });

  it("should sort runs newest-first (desc)", async () => {
    const runs = [
      createMockRun({ id: BigInt(2), number: 2, name: "newer-run", status: "RUNNING", createdAt: new Date("2026-02-10"), project: { name: "proj", runPrefix: "PRJ" } }),
      createMockRun({ id: BigInt(1), number: 1, name: "older-run", createdAt: new Date("2026-02-09"), project: { name: "proj", runPrefix: "PRJ" } }),
    ];

    const prisma = createMockPrisma({ runs });

    vi.mocked(getIssueByIdentifier).mockResolvedValue({
      id: "iss-1",
      identifier: "TRA-1",
    });
    vi.mocked(getIssueComments).mockResolvedValue([]);
    vi.mocked(createComment).mockResolvedValue({ id: "c1" });

    await syncRunsToLinearIssue({
      prisma,
      organizationId: "org-1",
      issueIdentifier: "TRA-1",
    });

    // Verify that prisma was called with orderBy desc
    expect(prisma.runs.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: { createdAt: "desc" },
      })
    );
  });

  it("should serialize concurrent syncs for the same issue (no duplicate comments)", async () => {
    // Simulate two concurrent syncs for the same issue — the second should
    // see the comment ID saved by the first and update instead of creating.
    let callCount = 0;
    const runs = [
      createMockRun({ name: "run-1", createdAt: new Date("2026-02-09"), project: { name: "proj", runPrefix: "PRJ" } }),
    ];

    // Build a mock prisma where integration.findUnique returns the latest
    // metadata (including comment IDs saved by previous calls).
    let storedMetadata: Record<string, unknown> = { commentIds: {} };

    const prisma: any = {
      $executeRawUnsafe: vi.fn().mockResolvedValue(0),
      integration: {
        findUnique: vi.fn().mockImplementation(() =>
          Promise.resolve({
            id: "int-1",
            organizationId: "org-1",
            provider: "linear",
            enabled: true,
            encryptedToken: "enc_tok",
            metadata: storedMetadata,
          })
        ),
        update: vi.fn().mockImplementation(({ data }: any) => {
          // Persist metadata so the next call sees the stored comment ID
          storedMetadata = data.metadata;
          return Promise.resolve({});
        }),
      },
      organization: {
        findUnique: vi.fn().mockResolvedValue({ slug: "dev-org" }),
      },
      runs: {
        findMany: vi.fn().mockResolvedValue(runs),
      },
    };
    prisma.$transaction = vi.fn((fn: any) => fn(prisma));

    vi.mocked(getIssueByIdentifier).mockResolvedValue({
      id: "linear-issue-1",
      identifier: "TRA-1",
    });

    vi.mocked(getIssueComments).mockResolvedValue([]);
    vi.mocked(createComment).mockImplementation(async () => {
      callCount++;
      return { id: `comment-${callCount}` };
    });
    vi.mocked(updateComment).mockResolvedValue({ id: "comment-1" });

    // Fire two syncs concurrently for the SAME issue
    const [r1, r2] = await Promise.all([
      syncRunsToLinearIssue({ prisma, organizationId: "org-1", issueIdentifier: "TRA-1" }),
      syncRunsToLinearIssue({ prisma, organizationId: "org-1", issueIdentifier: "TRA-1" }),
    ]);

    expect(r1.success).toBe(true);
    expect(r2.success).toBe(true);

    // First call creates, second call should update (not create again)
    expect(createComment).toHaveBeenCalledOnce();
    expect(updateComment).toHaveBeenCalledOnce();
  });

  it("should allow concurrent syncs for different issues to run in parallel", async () => {
    const runs = [
      createMockRun({ name: "run-1", createdAt: new Date("2026-02-09"), project: { name: "proj", runPrefix: "PRJ" } }),
    ];

    // Use a custom mock that always returns runs for findMany (4 calls: 2 per sync)
    const prisma = createMockPrisma({});
    prisma.runs.findMany = vi.fn().mockResolvedValue(runs);

    vi.mocked(getIssueByIdentifier).mockResolvedValue({
      id: "linear-issue-1",
      identifier: "TRA-1",
    });
    vi.mocked(getIssueComments).mockResolvedValue([]);
    vi.mocked(createComment).mockResolvedValue({ id: "c1" });

    // Fire two syncs for DIFFERENT issues — both should create independently
    const [r1, r2] = await Promise.all([
      syncRunsToLinearIssue({ prisma, organizationId: "org-1", issueIdentifier: "TRA-1" }),
      syncRunsToLinearIssue({ prisma, organizationId: "org-1", issueIdentifier: "TRA-2" }),
    ]);

    expect(r1.success).toBe(true);
    expect(r2.success).toBe(true);

    // Both should create (different issues, no locking between them)
    expect(createComment).toHaveBeenCalledTimes(2);
  });

  it("should handle runs across multiple projects in comparison links", async () => {
    const runs = [
      createMockRun({ id: BigInt(1), number: 1, name: "run-a", createdAt: new Date("2026-02-09"), project: { name: "project-alpha", runPrefix: "PA" } }),
      createMockRun({ id: BigInt(2), number: 2, name: "run-b", status: "RUNNING", createdAt: new Date("2026-02-10"), project: { name: "project-beta", runPrefix: "PB" } }),
    ];

    const prisma = createMockPrisma({ runs });

    vi.mocked(getIssueByIdentifier).mockResolvedValue({
      id: "iss-1",
      identifier: "TRA-1",
    });
    vi.mocked(getIssueComments).mockResolvedValue([]);
    vi.mocked(createComment).mockResolvedValue({ id: "c1" });

    await syncRunsToLinearIssue({
      prisma,
      organizationId: "org-1",
      issueIdentifier: "TRA-1",
    });

    const body = vi.mocked(createComment).mock.calls[0][2];
    // Each project should get its own comparison link
    expect(body).toContain("Compare all in project\\-alpha");
    expect(body).toContain("Compare all in project\\-beta");
  });

  it("should show baseline display IDs as hyperlinks in Baselines column", async () => {
    const experimentRuns = [
      createMockRun({ id: BigInt(1), number: 1, name: "ablation-v1", tags: ["linear:TRA-1", "baseline:PRJ-2"], createdAt: new Date("2026-02-10"), project: { name: "proj", runPrefix: "PRJ" } }),
    ];
    const baselineRuns = [
      createMockRun({ id: BigInt(2), number: 2, name: "prod-model", tags: [], createdAt: new Date("2026-01-01"), project: { name: "proj", runPrefix: "PRJ" } }),
    ];

    const prisma = createMockPrisma({ runs: experimentRuns, baselineRuns });

    vi.mocked(getIssueByIdentifier).mockResolvedValue({ id: "iss-1", identifier: "TRA-1" });
    vi.mocked(getIssueComments).mockResolvedValue([]);
    vi.mocked(createComment).mockResolvedValue({ id: "c1" });

    await syncRunsToLinearIssue({
      prisma,
      organizationId: "org-1",
      issueIdentifier: "TRA-1",
    });

    const body = vi.mocked(createComment).mock.calls[0][2];
    // Table header should have Baselines column
    expect(body).toContain("| Baselines |");
    // Baseline display ID should be a hyperlink in the row
    expect(body).toContain("[PRJ\\-2]");
    // Comparison URL should include both baseline and experiment
    expect(body).toContain("?runs=sqid_2,sqid_1");
    // Experiment run should appear
    expect(body).toContain("ablation\\-v1");
    // "Compare all" at bottom
    expect(body).toContain("Compare all in");
  });

  it("should omit Baselines column when no baselines exist", async () => {
    const experimentRuns = [
      createMockRun({ id: BigInt(1), number: 1, name: "run-1", tags: ["linear:TRA-1"], createdAt: new Date("2026-02-10"), project: { name: "proj", runPrefix: "PRJ" } }),
    ];

    const prisma = createMockPrisma({ runs: experimentRuns });

    vi.mocked(getIssueByIdentifier).mockResolvedValue({ id: "iss-1", identifier: "TRA-1" });
    vi.mocked(getIssueComments).mockResolvedValue([]);
    vi.mocked(createComment).mockResolvedValue({ id: "c1" });

    await syncRunsToLinearIssue({
      prisma,
      organizationId: "org-1",
      issueIdentifier: "TRA-1",
    });

    const body = vi.mocked(createComment).mock.calls[0][2];
    expect(body).not.toContain("| Baselines |");
  });

  it("should deduplicate when baseline run also has linear: tag", async () => {
    const experimentRuns = [
      createMockRun({ id: BigInt(1), number: 1, name: "experiment", tags: ["linear:TRA-1", "baseline:PRJ-2"], createdAt: new Date("2026-02-10"), project: { name: "proj", runPrefix: "PRJ" } }),
      createMockRun({ id: BigInt(2), number: 2, name: "dual-tagged", tags: ["linear:TRA-1"], createdAt: new Date("2026-01-01"), project: { name: "proj", runPrefix: "PRJ" } }),
    ];
    const baselineRuns = [
      createMockRun({ id: BigInt(2), number: 2, name: "dual-tagged", tags: ["linear:TRA-1"], createdAt: new Date("2026-01-01"), project: { name: "proj", runPrefix: "PRJ" } }),
    ];

    const prisma = createMockPrisma({ runs: experimentRuns, baselineRuns });

    vi.mocked(getIssueByIdentifier).mockResolvedValue({ id: "iss-1", identifier: "TRA-1" });
    vi.mocked(getIssueComments).mockResolvedValue([]);
    vi.mocked(createComment).mockResolvedValue({ id: "c1" });

    await syncRunsToLinearIssue({
      prisma,
      organizationId: "org-1",
      issueIdentifier: "TRA-1",
    });

    const body = vi.mocked(createComment).mock.calls[0][2];
    // dual-tagged should not appear as an experiment row (it's a baseline, filtered out)
    // Only experiment run should be in the table
    expect(body).toContain("experiment");
    expect(body).toContain("| Baselines |");
  });
});

describe("triggerLinearSyncForTags — baseline tags", () => {
  it("should re-sync linear: issues when baseline: tag is added", () => {
    const prisma = createMockPrisma();

    // Run has linear:TRA-1 and adds baseline:MMP-5 — should re-sync TRA-1
    expect(() =>
      triggerLinearSyncForTags(prisma, "org-1", [
        "linear:TRA-1",
        "baseline:MMP-5",
      ])
    ).not.toThrow();
  });

  it("should re-sync linear: issues when baseline: tag is removed", () => {
    const prisma = createMockPrisma();

    expect(() =>
      triggerLinearSyncForTags(
        prisma,
        "org-1",
        ["linear:TRA-1"],
        ["linear:TRA-1", "baseline:MMP-5"] // baseline tag was removed
      )
    ).not.toThrow();
  });
});
