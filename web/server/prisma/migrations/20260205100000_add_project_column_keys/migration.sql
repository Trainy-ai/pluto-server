-- Enable pg_trgm extension for trigram-based ILIKE indexing
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- CreateTable
CREATE TABLE "project_column_keys" (
    "id" BIGSERIAL NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" BIGINT NOT NULL,
    "source" VARCHAR(20) NOT NULL,
    "key" VARCHAR(500) NOT NULL,
    "dataType" VARCHAR(10) NOT NULL,

    CONSTRAINT "project_column_keys_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: unique constraint on (projectId, source, key)
CREATE UNIQUE INDEX "project_column_keys_projectId_source_key_key" ON "project_column_keys"("projectId", "source", "key");

-- CreateIndex: composite lookup index
CREATE INDEX "project_column_keys_projectId_organizationId_idx" ON "project_column_keys"("projectId", "organizationId");

-- CreateIndex: GIN trigram index for fast ILIKE search on key column
CREATE INDEX "project_column_keys_key_trgm_idx" ON "project_column_keys" USING gin ("key" gin_trgm_ops);

-- AddForeignKey
ALTER TABLE "project_column_keys" ADD CONSTRAINT "project_column_keys_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_column_keys" ADD CONSTRAINT "project_column_keys_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
