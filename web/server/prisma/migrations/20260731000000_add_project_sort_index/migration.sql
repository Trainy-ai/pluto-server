-- CreateIndex: covering index for "latest run per project" lookups.
--
-- The projects table can sort by Last Run At, Last Run and Latest Run Status.
-- All three read the project's most recent run, which the list query resolves
-- with a LATERAL "ORDER BY updatedAt DESC LIMIT 1" per project. The existing
-- (organizationId, projectId, createdAt DESC) index doesn't help that ordering,
-- so without this index each project's entire run history is scanned to find
-- one row — on the largest table in the schema.
CREATE INDEX IF NOT EXISTS "runs_organizationId_projectId_updatedAt_idx"
ON "runs"("organizationId", "projectId", "updatedAt" DESC);
