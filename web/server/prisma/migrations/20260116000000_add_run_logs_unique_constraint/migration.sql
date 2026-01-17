-- CreateIndex
-- This unique constraint is required for Prisma's skipDuplicates to work correctly
-- in the addLogName endpoint, preventing duplicate log names per run during concurrent requests
CREATE UNIQUE INDEX "run_logs_runId_logName_key" ON "run_logs"("runId", "logName");
