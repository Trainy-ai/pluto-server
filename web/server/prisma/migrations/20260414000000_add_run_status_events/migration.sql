-- CreateTable: Append-only log of run status transitions.
-- Emitted only on actual state changes; the write helper elides no-ops,
-- so DDP fan-out from N ranks collapses to a single event per transition.
CREATE TABLE "run_status_events" (
    "id" BIGSERIAL NOT NULL,
    "runId" BIGINT NOT NULL,
    "fromStatus" "RunStatus",
    "toStatus" "RunStatus" NOT NULL,
    "source" VARCHAR(64) NOT NULL,
    "metadata" JSONB,
    "actorId" TEXT,
    "apiKeyId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "run_status_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: Covers the typical "timeline for a run" read pattern.
CREATE INDEX "run_status_events_runId_createdAt_idx" ON "run_status_events"("runId", "createdAt");

-- AddForeignKey: runId -> runs.id, cascade on run delete.
ALTER TABLE "run_status_events" ADD CONSTRAINT "run_status_events_runId_fkey"
    FOREIGN KEY ("runId") REFERENCES "runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: actorId -> user.id, set null if user is deleted.
ALTER TABLE "run_status_events" ADD CONSTRAINT "run_status_events_actorId_fkey"
    FOREIGN KEY ("actorId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey: apiKeyId -> api_key.id, set null if key is deleted.
ALTER TABLE "run_status_events" ADD CONSTRAINT "run_status_events_apiKeyId_fkey"
    FOREIGN KEY ("apiKeyId") REFERENCES "api_key"("id") ON DELETE SET NULL ON UPDATE CASCADE;
