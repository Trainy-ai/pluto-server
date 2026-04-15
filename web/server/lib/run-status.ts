/**
 * Run status transition helper.
 *
 * Centralises every mutation of `Runs.status` so that we can (a) record a
 * durable audit trail in `RunStatusEvent` and (b) enforce a precedence-based
 * state machine that stays correct under DDP concurrency — where N ranks may
 * post `status/update` for the same run in parallel.
 *
 * Precedence rule (terminal-to-terminal):
 *   FAILED > CANCELLED > TERMINATED > COMPLETED
 * A late rank reporting a lower-severity terminal status after another rank
 * has already reported a higher-severity one is rejected as a stale write.
 * Non-api sources (`resume`, `stale-monitor`, `threshold-trigger`) are
 * exempt from the precedence check because they represent deliberate
 * backend actions, not racing client reports.
 *
 * An event is only emitted when the status actually changes — no-op writes
 * (same fromStatus === toStatus) collapse to zero events, which is how DDP
 * fan-out from 8 ranks all reporting COMPLETED reduces to a single row.
 */

import { Prisma } from "@prisma/client";
import type { PrismaClient, RunStatus } from "@prisma/client";

export type RunStatusTransitionSource =
  | "api"
  | "resume"
  | "stale-monitor"
  | "threshold-trigger";

export interface TransitionArgs {
  runId: bigint;
  toStatus: RunStatus;
  source: RunStatusTransitionSource;
  /** Optional JSON blob to snapshot into RunStatusEvent.metadata (also mirrored to Runs.statusMetadata when undefined is not passed). */
  metadata?: Prisma.InputJsonValue | null;
  /** If provided, merged with loggerSettings on the Runs row. */
  loggerSettingsPatch?: Record<string, unknown>;
  /** Organization scope enforced by callers that already have an api-key / session; optional defence-in-depth. */
  organizationId?: string;
  /** Session user, if any. */
  actorId?: string | null;
  /** API key used, if any. */
  apiKeyId?: string | null;
}

export interface TransitionResult {
  updated: boolean;
  eventId: bigint | null;
  /** True if the write was silently rejected by the precedence rule. */
  ignored: boolean;
  fromStatus: RunStatus | null;
  toStatus: RunStatus;
}

/**
 * Terminal-state severity. Higher wins when two terminal transitions race.
 * RUNNING is listed for completeness but the precedence check only fires
 * when both fromStatus and toStatus are terminal.
 */
const SEVERITY: Record<RunStatus, number> = {
  RUNNING: -1,
  COMPLETED: 0,
  TERMINATED: 1,
  CANCELLED: 2,
  FAILED: 3,
};

const TERMINAL: ReadonlySet<RunStatus> = new Set<RunStatus>([
  "COMPLETED",
  "FAILED",
  "CANCELLED",
  "TERMINATED",
]);

export async function transitionRunStatus(
  prisma: PrismaClient,
  args: TransitionArgs
): Promise<TransitionResult> {
  return prisma.$transaction(async (tx) => {
    // Row-lock the run so concurrent writers serialise. This is what makes
    // the precedence rule race-free — every transition reads the current
    // status under lock before writing.
    const locked = await tx.$queryRaw<
      Array<{ id: bigint; status: RunStatus; organizationId: string }>
    >`SELECT id, status, "organizationId" FROM runs WHERE id = ${args.runId} FOR UPDATE`;

    if (locked.length === 0) {
      return {
        updated: false,
        eventId: null,
        ignored: false,
        fromStatus: null,
        toStatus: args.toStatus,
      };
    }

    const row = locked[0];

    // Defence-in-depth: reject cross-org writes.
    if (args.organizationId && row.organizationId !== args.organizationId) {
      return {
        updated: false,
        eventId: null,
        ignored: true,
        fromStatus: row.status,
        toStatus: args.toStatus,
      };
    }

    const fromStatus = row.status;

    // Precedence: reject lower-severity terminal overwriting higher-severity.
    // Only applies to `api` source — deliberate backend transitions bypass.
    if (
      args.source === "api" &&
      TERMINAL.has(fromStatus) &&
      TERMINAL.has(args.toStatus) &&
      SEVERITY[args.toStatus] < SEVERITY[fromStatus]
    ) {
      return {
        updated: false,
        eventId: null,
        ignored: true,
        fromStatus,
        toStatus: args.toStatus,
      };
    }

    // Build update payload. We always refresh statusUpdated so clients can
    // see recent liveness even when the state didn't change.
    const data: Prisma.RunsUpdateInput = {
      status: args.toStatus,
      statusUpdated: new Date(),
    };

    if (args.metadata !== undefined) {
      data.statusMetadata = args.metadata === null ? Prisma.DbNull : args.metadata;
    }

    if (args.loggerSettingsPatch && Object.keys(args.loggerSettingsPatch).length > 0) {
      // Caller is responsible for having already merged with existing settings;
      // we just write the resulting object.
      data.loggerSettings = args.loggerSettingsPatch as Prisma.InputJsonValue;
    }

    await tx.runs.update({
      where: { id: args.runId },
      data,
    });

    // No-op transitions: refresh the row but skip the event (keeps the
    // timeline free of DDP duplicates).
    if (fromStatus === args.toStatus) {
      return {
        updated: true,
        eventId: null,
        ignored: false,
        fromStatus,
        toStatus: args.toStatus,
      };
    }

    const event = await tx.runStatusEvent.create({
      data: {
        runId: args.runId,
        fromStatus,
        toStatus: args.toStatus,
        source: args.source,
        metadata:
          args.metadata === undefined || args.metadata === null
            ? Prisma.DbNull
            : args.metadata,
        actorId: args.actorId ?? null,
        apiKeyId: args.apiKeyId ?? null,
      },
      select: { id: true },
    });

    return {
      updated: true,
      eventId: event.id,
      ignored: false,
      fromStatus,
      toStatus: args.toStatus,
    };
  });
}

/**
 * Record the implicit RUNNING event at run creation. Called inside the same
 * transaction as the `runs.create` so the log cannot lag the row.
 */
export async function recordRunCreatedEvent(
  tx: Prisma.TransactionClient,
  args: {
    runId: bigint;
    source: RunStatusTransitionSource;
    apiKeyId?: string | null;
    actorId?: string | null;
  }
) {
  await tx.runStatusEvent.create({
    data: {
      runId: args.runId,
      fromStatus: null,
      toStatus: "RUNNING",
      source: args.source,
      apiKeyId: args.apiKeyId ?? null,
      actorId: args.actorId ?? null,
    },
  });
}
