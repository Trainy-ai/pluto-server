import type { PrismaClient } from "@prisma/client";
import { createComment, updateComment, getIssueByIdentifier, getIssueComments } from "./linear-client";
import { getValidToken } from "./linear-oauth";
import { sqidEncode } from "./sqid";
import { env } from "./env";
import { resolveRunId } from "./resolve-run-id";

interface SyncOptions {
  prisma: PrismaClient;
  organizationId: string;
  issueIdentifier: string;
}

interface SyncResult {
  success: boolean;
  error?: string;
}

interface SyncRun {
  id: bigint;
  number: number | null;
  name: string;
  status: string;
  createdAt: Date;
  project: { name: string; runPrefix: string | null };
}

// ---------------------------------------------------------------------------
// Per-issue lock to prevent concurrent syncs from racing and creating
// duplicate comments on the same Linear issue.
// ---------------------------------------------------------------------------
const issueLocks = new Map<string, Promise<SyncResult>>();

function withIssueLock(key: string, fn: () => Promise<SyncResult>): Promise<SyncResult> {
  const prev = issueLocks.get(key) ?? Promise.resolve({ success: true });
  // Chain: wait for previous sync to finish (regardless of outcome), then run fn
  const next = prev.then(fn, fn);
  issueLocks.set(key, next);
  // Clean up entry once this is the tail of the chain (no new work queued)
  void next.finally(() => {
    if (issueLocks.get(key) === next) {
      issueLocks.delete(key);
    }
  });
  return next;
}

/** Exposed for tests only — clears all pending locks. */
export function _resetIssueLocks(): void {
  issueLocks.clear();
}

function escapeMarkdown(text: string): string {
  return text.replace(/[|\\`*_{}[\]()#+\-.!~>]/g, "\\$&").replace(/\n/g, " ");
}

/**
 * Fire-and-forget sync for all linear: tags in a tag array.
 * Call from any tag-update path to avoid duplicating trigger logic.
 * Pass previousTags to also re-sync any linear: tags that were removed.
 *
 * baseline: tags point to run display IDs (e.g. "baseline:MMP-169"), not
 * Linear issues, so they don't directly trigger a sync. However, adding or
 * removing a baseline: tag on a run that also has linear: tags should re-sync
 * those issues so the comment table updates.
 */
export function triggerLinearSyncForTags(
  prisma: PrismaClient,
  organizationId: string,
  tags: string[],
  previousTags?: string[],
): void {
  const linearTags = new Set(tags.filter((t) => t.startsWith("linear:")));

  // Also re-sync any removed linear: tags so the comment drops the untagged run
  if (previousTags) {
    for (const t of previousTags) {
      if (t.startsWith("linear:") && !linearTags.has(t)) {
        linearTags.add(t);
      }
    }
  }

  // If a baseline: tag was added/removed, re-sync all linear: issues on this run
  // so the comment table picks up the baseline change.
  const hasBaselineChange =
    tags.some((t) => t.startsWith("baseline:")) ||
    (previousTags?.some((t) => t.startsWith("baseline:")) ?? false);
  if (hasBaselineChange) {
    // Ensure all current linear: tags are synced
    for (const t of tags) {
      if (t.startsWith("linear:")) linearTags.add(t);
    }
    if (previousTags) {
      for (const t of previousTags) {
        if (t.startsWith("linear:")) linearTags.add(t);
      }
    }
  }

  console.log(`[linear-sync] triggerLinearSyncForTags: orgId=${organizationId} linearTags=[${[...linearTags].join(", ")}]`);

  for (const tag of linearTags) {
    const issueIdentifier = tag.slice("linear:".length);
    if (issueIdentifier) {
      void syncRunsToLinearIssue({ prisma, organizationId, issueIdentifier })
        .then((result) => {
          if (!result.success) {
            console.error(`[linear-sync] sync failed for ${issueIdentifier}:`, result.error);
          } else {
            console.log(`[linear-sync] sync succeeded for ${issueIdentifier}`);
          }
        })
        .catch((err) => console.error("[linear-sync] sync threw for", issueIdentifier, err));
    }
  }
}

export function syncRunsToLinearIssue(options: SyncOptions): Promise<SyncResult> {
  const key = `${options.organizationId}:${options.issueIdentifier}`;
  return withIssueLock(key, () => syncRunsToLinearIssueInternal(options));
}

/** Look up an existing Pluto comment on the issue; update it if found, create if not. */
async function findOrCreatePlutoComment(token: string, issueId: string, body: string): Promise<string> {
  const existingIds = await getIssueComments(token, issueId);
  console.log(`[linear-sync] findOrCreatePlutoComment: issueId=${issueId} existingPlutoComments=${existingIds.length} ids=[${existingIds.join(", ")}]`);
  if (existingIds.length > 0) {
    await updateComment(token, existingIds[0], body);
    return existingIds[0];
  }
  const comment = await createComment(token, issueId, body);
  console.log(`[linear-sync] created new comment: ${comment.id}`);
  return comment.id;
}

async function syncRunsToLinearIssueInternal({ prisma, organizationId, issueIdentifier }: SyncOptions): Promise<SyncResult> {
  // ---------------------------------------------------------------------------
  // Phase 1: Read state inside a transaction with advisory lock
  // ---------------------------------------------------------------------------
  const lockKey = `linear-sync:${organizationId}:${issueIdentifier}`;

  const txResult = await prisma.$transaction(async (tx: any) => {
    await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(hashtext($1))`, lockKey);

    const integration = await tx.integration.findUnique({
      where: {
        organizationId_provider: {
          organizationId,
          provider: "linear",
        },
      },
    });

    if (!integration || !integration.enabled) {
      return { bail: true as const, result: { success: false, error: "Linear integration not configured or disabled" } };
    }

    const org = await tx.organization.findUnique({
      where: { id: organizationId },
      select: { slug: true },
    });

    if (!org) {
      return { bail: true as const, result: { success: false, error: "Organization not found" } };
    }

    const tagValue = `linear:${issueIdentifier}`;
    const runSelect = {
      id: true,
      number: true,
      name: true,
      status: true,
      tags: true,
      createdAt: true,
      project: { select: { name: true, runPrefix: true } },
    };

    const experimentRuns: (SyncRun & { tags: string[] })[] = await tx.runs.findMany({
      where: { organizationId, tags: { has: tagValue } },
      select: runSelect,
      orderBy: { createdAt: "desc" },
    });

    // Scan experiment runs for baseline: tags pointing to run display IDs.
    // e.g. "baseline:MMP-169" means "my baseline is run MMP-169".
    const baselineDisplayIds = new Set<string>();
    for (const run of experimentRuns) {
      for (const tag of run.tags) {
        if (tag.startsWith("baseline:")) {
          const displayId = tag.slice("baseline:".length);
          if (displayId) baselineDisplayIds.add(displayId);
        }
      }
    }

    // Resolve baseline display IDs to actual runs
    const baselineRunIds: bigint[] = [];
    for (const displayId of baselineDisplayIds) {
      try {
        const numericId = await resolveRunId(tx as any, displayId, organizationId);
        baselineRunIds.push(BigInt(numericId));
      } catch {
        console.log(`[linear-sync] could not resolve baseline run "${displayId}", skipping`);
      }
    }

    const baselineRuns: SyncRun[] = baselineRunIds.length > 0
      ? await tx.runs.findMany({
          where: { id: { in: baselineRunIds } },
          select: { id: true, number: true, name: true, status: true, createdAt: true, project: { select: { name: true, runPrefix: true } } },
        })
      : [];

    // Merge: baselines first, then experiments (dedup if a baseline also has linear: tag)
    const baselineIdSet = new Set(baselineRuns.map((r) => r.id));
    const runs: (SyncRun & { role: "baseline" | "experiment" })[] = [
      ...baselineRuns.map((r) => ({ ...r, role: "baseline" as const })),
      ...experimentRuns.filter((r) => !baselineIdSet.has(r.id)).map(({ tags: _tags, ...r }) => ({ ...r, role: "experiment" as const })),
    ];

    const metadata = (integration.metadata ?? {}) as Record<string, unknown>;
    const commentIds = (metadata.commentIds ?? {}) as Record<string, string>;
    const existingCommentId = commentIds[issueIdentifier] as string | undefined;

    return {
      bail: false as const,
      orgSlug: org.slug,
      runs,
      metadata,
      commentIds,
      existingCommentId,
    };
  }, { timeout: 30000 });

  // Early return for bail conditions
  if (txResult.bail) {
    return txResult.result;
  }

  const { orgSlug, runs, metadata, commentIds, existingCommentId } = txResult;

  console.log(`[linear-sync] issue=${issueIdentifier} runs=${runs.length} storedCommentId=${existingCommentId ?? "none"} runNames=[${runs.map((r: SyncRun) => r.name).join(", ")}]`);

  // ---------------------------------------------------------------------------
  // Phase 2: Get valid token and call Linear API (outside transaction)
  // ---------------------------------------------------------------------------
  let token: string;
  try {
    token = await getValidToken(prisma, organizationId);
  } catch {
    return { success: false, error: "Failed to get valid Linear token" };
  }

  // If no runs are tagged, update the comment to reflect that
  if (runs.length === 0) {
    const body = [
      "## Pluto Experiments",
      "",
      "_No runs are currently linked to this issue._",
      "",
      "_Auto-updated by Pluto_",
    ].join("\n");

    if (existingCommentId) {
      try {
        await updateComment(token, existingCommentId, body);
      } catch {
        // Comment may have been deleted, nothing to update
      }
    }

    return { success: true };
  }

  // Build a map from baseline run ID → { displayId, encodedId, url } for linking
  const baselineRuns = runs.filter((r) => r.role === "baseline");
  const experimentRuns = runs.filter((r) => r.role === "experiment");
  const hasBaselines = baselineRuns.length > 0;

  // Helper to build run URL and display ID
  function runMeta(run: typeof runs[number]) {
    const encodedId = sqidEncode(Number(run.id));
    const projectName = run.project.name;
    const url = `${env.BETTER_AUTH_URL}/o/${orgSlug}/projects/${encodeURIComponent(projectName)}/${encodedId}`;
    const displayId = run.number != null && run.project.runPrefix
      ? `${run.project.runPrefix}-${run.number}`
      : encodedId;
    const date = run.createdAt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    return { encodedId, projectName, url, displayId, date };
  }

  // Map baseline display IDs to their metadata (for building inline links)
  const baselineByDisplayId = new Map<string, { encodedId: string; url: string; displayId: string }>();
  for (const r of baselineRuns) {
    const m = runMeta(r);
    baselineByDisplayId.set(m.displayId, { encodedId: m.encodedId, url: m.url, displayId: m.displayId });
  }

  // For each experiment run, find its baseline: tags and build the Baselines column
  // Each experiment run's tags contain baseline:DISPLAY_ID entries
  const allRuns = experimentRuns.length > 0 ? experimentRuns : runs;
  const rows = allRuns.map((run) => {
    const m = runMeta(run);

    if (!hasBaselines) {
      return `| ${escapeMarkdown(m.displayId)} | [${escapeMarkdown(run.name)}](${m.url}) | ${escapeMarkdown(m.projectName)} | ${run.status} | ${m.date} |`;
    }

    // Find this run's baselines from the resolved baseline runs
    // Build comparison URL: all baseline IDs + this run's ID
    const baselineEncodedIds = baselineRuns.map((b) => sqidEncode(Number(b.id)));
    const compareIds = [...baselineEncodedIds, m.encodedId].join(",");
    const compareUrl = `${env.BETTER_AUTH_URL}/o/${orgSlug}/projects/${encodeURIComponent(m.projectName)}?runs=${compareIds}`;

    // Build baseline links as comma-separated hyperlinked display IDs
    const baselineLinks = baselineRuns.map((b) => {
      const bm = runMeta(b);
      return `[${escapeMarkdown(bm.displayId)}](${compareUrl})`;
    }).join(", ");

    return `| ${escapeMarkdown(m.displayId)} | [${escapeMarkdown(run.name)}](${m.url}) | ${escapeMarkdown(m.projectName)} | ${run.status} | ${baselineLinks} | ${m.date} |`;
  });

  // Build "compare all" link
  const allRunsByProject = new Map<string, string[]>();
  for (const run of runs) {
    const m = runMeta(run);
    if (!allRunsByProject.has(m.projectName)) {
      allRunsByProject.set(m.projectName, []);
    }
    allRunsByProject.get(m.projectName)!.push(m.encodedId);
  }
  const comparisonLinks: string[] = [];
  for (const [projectName, encodedIds] of allRunsByProject) {
    const comparisonUrl = `${env.BETTER_AUTH_URL}/o/${orgSlug}/projects/${encodeURIComponent(projectName)}?runs=${encodedIds.join(",")}`;
    comparisonLinks.push(`[Compare all in ${escapeMarkdown(projectName)}](${comparisonUrl})`);
  }

  const tableHeader = hasBaselines
    ? "| Run ID | Run | Project | Status | Baselines | Created |"
    : "| Run ID | Run | Project | Status | Created |";
  const tableSeparator = hasBaselines
    ? "|--------|-----|---------|--------|-----------|---------|"
    : "|--------|-----|---------|--------|---------|";

  const body = [
    "## Pluto Experiments",
    "",
    tableHeader,
    tableSeparator,
    ...rows,
    "",
    comparisonLinks.join(" · "),
    "",
    "_Auto-updated by Pluto_",
  ].join("\n");

  console.log(`[linear-sync] built comment for ${issueIdentifier}: ${rows.length} table rows, body length=${body.length}`);

  // Resolve the issue identifier to an ID
  let issue;
  try {
    issue = await getIssueByIdentifier(token, issueIdentifier);
  } catch {
    return { success: false, error: `Failed to find Linear issue ${issueIdentifier}` };
  }

  if (!issue) {
    return { success: false, error: `Linear issue ${issueIdentifier} not found` };
  }

  // Idempotent create-or-update logic:
  // 1. If stored commentId exists → try updateComment
  // 2. If no stored ID OR update failed → query Linear for existing Pluto comment
  // 3. If found → updateComment with that ID
  // 4. Only if nothing found → createComment
  try {
    let commentId: string;

    if (existingCommentId) {
      try {
        console.log(`[linear-sync] updating stored comment ${existingCommentId} for ${issueIdentifier}`);
        await updateComment(token, existingCommentId, body);
        commentId = existingCommentId;
        console.log(`[linear-sync] updated stored comment successfully`);
      } catch (updateErr) {
        console.log(`[linear-sync] stored comment update failed, recovering:`, updateErr);
        // Stored comment may have been deleted — recover or create
        commentId = await findOrCreatePlutoComment(token, issue.id, body);
      }
    } else {
      console.log(`[linear-sync] no stored comment ID for ${issueIdentifier}, looking up or creating`);
      // No stored ID — recover orphaned comment or create new
      commentId = await findOrCreatePlutoComment(token, issue.id, body);
    }

    // ---------------------------------------------------------------------------
    // Phase 3: Save comment ID to metadata (simple update, outside original tx)
    // ---------------------------------------------------------------------------
    await (prisma as any).integration.update({
      where: {
        organizationId_provider: {
          organizationId,
          provider: "linear",
        },
      },
      data: {
        metadata: {
          ...metadata,
          commentIds: {
            ...commentIds,
            [issueIdentifier]: commentId,
          },
        },
      },
    });

    return { success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return { success: false, error: `Failed to sync comment: ${message}` };
  }
}
