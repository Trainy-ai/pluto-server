-- CreateIndex: covering index for default sort (createdAt DESC) scoped to org+project
CREATE INDEX IF NOT EXISTS "runs_organizationId_projectId_createdAt_idx"
ON "runs"("organizationId", "projectId", "createdAt" DESC);

-- CreateIndex: covering index for name sort scoped to org+project
CREATE INDEX IF NOT EXISTS "runs_organizationId_projectId_name_idx"
ON "runs"("organizationId", "projectId", "name");
