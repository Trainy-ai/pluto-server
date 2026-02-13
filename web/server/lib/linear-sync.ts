import type { PrismaClient } from "@prisma/client";
import { decrypt } from "./encryption";
import { createComment, updateComment, getIssueByIdentifier } from "./linear-client";
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

  for (const tag of linearTags) {
    const issueIdentifier = tag.slice("linear:".length);
    if (issueIdentifier) {
      void syncRunsToLinearIssue({ prisma, organizationId, issueIdentifier })
        .catch((err) => console.error("Linear sync failed:", err));
    }
  }
}

export async function syncRunsToLinearIssue({ prisma, organizationId, issueIdentifier }: SyncOptions): Promise<SyncResult> {
  // Get the org's Linear integration
  const integration = await prisma.integration.findUnique({
    where: {
      organizationId_provider: {
        organizationId,
        provider: "linear",
      },
    },
  });

  if (!integration || !integration.enabled) {
    return { success: false, error: "Linear integration not configured or disabled" };
  }

  let token: string;
  try {
    token = decrypt(integration.encryptedToken);
  } catch {
    return { success: false, error: "Failed to decrypt Linear API token" };
  }

  // Find the org slug for building URLs
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { slug: true },
  });

  if (!org) {
    return { success: false, error: "Organization not found" };
  }

  // Find all runs in this org tagged with this issue
  const tagValue = `linear:${issueIdentifier}`;
  const runs = await prisma.runs.findMany({
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

  // If no runs are tagged, update the comment to reflect that
  if (runs.length === 0) {
    const body = [
      "## Pluto Experiments",
      "",
      "_No runs are currently linked to this issue._",
      "",
      "_Auto-updated by Pluto_",
    ].join("\n");

    const metadata = (integration.metadata ?? {}) as Record<string, unknown>;
    const commentIds = (metadata.commentIds ?? {}) as Record<string, string>;
    const existingCommentId = commentIds[issueIdentifier];

    if (existingCommentId) {
      try {
        await updateComment(token, existingCommentId, body);
      } catch {
        // Comment may have been deleted, nothing to update
      }
    }

    return { success: true };
  }

  // Build the markdown comment — run names are hyperlinked, sorted oldest-first
  const rows = runs.map((run) => {
    const encodedId = sqidEncode(Number(run.id));
    const projectName = run.project.name;
    const url = `${env.BETTER_AUTH_URL}/o/${org.slug}/projects/${encodeURIComponent(projectName)}/${encodedId}`;
    const date = run.createdAt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    return `| [${escapeMarkdown(run.name)}](${url}) | ${escapeMarkdown(projectName)} | ${run.status} | ${date} |`;
  });

  // Build a comparison URL with all linked runs pre-selected
  // Group runs by project since comparison view is per-project
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
    const comparisonUrl = `${env.BETTER_AUTH_URL}/o/${org.slug}/projects/${encodeURIComponent(projectName)}?runs=${encodedIds.join(",")}`;
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

  // Check for existing comment ID in metadata
  const metadata = (integration.metadata ?? {}) as Record<string, unknown>;
  const commentIds = (metadata.commentIds ?? {}) as Record<string, string>;
  const existingCommentId = commentIds[issueIdentifier];

  try {
    let commentId: string;

    if (existingCommentId) {
      // Try to update existing comment
      try {
        await updateComment(token, existingCommentId, body);
        commentId = existingCommentId;
      } catch {
        // Comment may have been deleted, create a new one
        const comment = await createComment(token, issue.id, body);
        commentId = comment.id;
      }
    } else {
      const comment = await createComment(token, issue.id, body);
      commentId = comment.id;
    }

    // Save the comment ID to metadata
    await prisma.integration.update({
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
