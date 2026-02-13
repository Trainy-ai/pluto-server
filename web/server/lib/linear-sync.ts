import type { PrismaClient } from "@prisma/client";
import { decrypt } from "./encryption";
import { createComment, updateComment, getIssueByIdentifier, getIssueComments } from "./linear-client";
import { sqidEncode } from "./sqid";
import { env } from "./env";

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
  name: string;
  status: string;
  createdAt: Date;
  project: { name: string };
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

    let token: string;
    try {
      token = decrypt(integration.encryptedToken);
    } catch {
      return { bail: true as const, result: { success: false, error: "Failed to decrypt Linear API token" } };
    }

    const org = await tx.organization.findUnique({
      where: { id: organizationId },
      select: { slug: true },
    });

    if (!org) {
      return { bail: true as const, result: { success: false, error: "Organization not found" } };
    }

    const tagValue = `linear:${issueIdentifier}`;
    const runs: SyncRun[] = await tx.runs.findMany({
      where: {
        organizationId,
        tags: { has: tagValue },
      },
      select: {
        id: true,
        name: true,
        status: true,
        createdAt: true,
        project: { select: { name: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    const metadata = (integration.metadata ?? {}) as Record<string, unknown>;
    const commentIds = (metadata.commentIds ?? {}) as Record<string, string>;
    const existingCommentId = commentIds[issueIdentifier] as string | undefined;

    return {
      bail: false as const,
      token,
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

  const { token, orgSlug, runs, metadata, commentIds, existingCommentId } = txResult;

  console.log(`[linear-sync] issue=${issueIdentifier} runs=${runs.length} storedCommentId=${existingCommentId ?? "none"} runNames=[${runs.map((r: SyncRun) => r.name).join(", ")}]`);

  // ---------------------------------------------------------------------------
  // Phase 2: Build comment body and call Linear API (outside transaction)
  // ---------------------------------------------------------------------------

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

  // Build the markdown comment — run names are hyperlinked
  const rows = runs.map((run) => {
    const encodedId = sqidEncode(Number(run.id));
    const projectName = run.project.name;
    const url = `${env.BETTER_AUTH_URL}/o/${orgSlug}/projects/${encodeURIComponent(projectName)}/${encodedId}`;
    const date = run.createdAt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    return `| [${escapeMarkdown(run.name)}](${url}) | ${escapeMarkdown(projectName)} | ${run.status} | ${date} |`;
  });

  // Build comparison URLs grouped by project
  const runsByProject = new Map<string, string[]>();
  for (const run of runs) {
    const encodedId = sqidEncode(Number(run.id));
    const projectName = run.project.name;
    if (!runsByProject.has(projectName)) {
      runsByProject.set(projectName, []);
    }
    runsByProject.get(projectName)!.push(encodedId);
  }

  const comparisonLinks: string[] = [];
  for (const [projectName, encodedIds] of runsByProject) {
    const comparisonUrl = `${env.BETTER_AUTH_URL}/o/${orgSlug}/projects/${encodeURIComponent(projectName)}?runs=${encodedIds.join(",")}`;
    comparisonLinks.push(`[Compare in ${escapeMarkdown(projectName)}](${comparisonUrl})`);
  }

  const body = [
    "## Pluto Experiments",
    "",
    "| Run | Project | Status | Created |",
    "|-----|---------|--------|---------|",
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
