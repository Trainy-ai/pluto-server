-- AlterTable: Add forking fields to runs
ALTER TABLE "runs" ADD COLUMN "forkedFromRunId" BIGINT;
ALTER TABLE "runs" ADD COLUMN "forkStep" BIGINT;

-- CreateIndex: Index on forkedFromRunId for efficient "list forks of run" queries
CREATE INDEX "runs_forkedFromRunId_idx" ON "runs"("forkedFromRunId");

-- AddForeignKey: Self-referential FK with SET NULL on delete
ALTER TABLE "runs" ADD CONSTRAINT "runs_forkedFromRunId_fkey" FOREIGN KEY ("forkedFromRunId") REFERENCES "runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
