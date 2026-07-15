-- CreateTable: per-run liveness signal.
-- The SDK monitor thread POSTs /api/runs/trigger every few seconds; that
-- endpoint upserts "lastSeen" here (write-coalesced), and the stale-run
-- monitor reads it to mark quiet runs FAILED on a short grace. One row per
-- run (runId is the primary key) so DDP fan-out collapses onto a single row
-- and the write path never touches the hot "runs" table.
CREATE TABLE "run_heartbeats" (
    "runId" BIGINT NOT NULL,
    "lastSeen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "run_heartbeats_pkey" PRIMARY KEY ("runId")
);

-- AddForeignKey: runId -> runs.id, cascade on run delete so heartbeats are
-- cleaned up with their run.
ALTER TABLE "run_heartbeats" ADD CONSTRAINT "run_heartbeats_runId_fkey"
    FOREIGN KEY ("runId") REFERENCES "runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
