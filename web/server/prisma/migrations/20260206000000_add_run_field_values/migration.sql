-- CreateTable
CREATE TABLE "run_field_values" (
    "id" BIGSERIAL NOT NULL,
    "runId" BIGINT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" BIGINT NOT NULL,
    "source" VARCHAR(20) NOT NULL,
    "key" VARCHAR(500) NOT NULL,
    "textValue" TEXT,
    "numericValue" DOUBLE PRECISION,

    CONSTRAINT "run_field_values_pkey" PRIMARY KEY ("id")
);

-- CreateIndex (unique constraint for upsert dedup)
CREATE UNIQUE INDEX "run_field_values_runId_source_key_key" ON "run_field_values"("runId", "source", "key");

-- CreateIndex (numeric sort/filter scoped to project+key)
CREATE INDEX "run_field_values_projectId_source_key_numericValue_idx" ON "run_field_values"("projectId", "source", "key", "numericValue");

-- CreateIndex (cascade/run-level lookups)
CREATE INDEX "run_field_values_runId_idx" ON "run_field_values"("runId");

-- AddForeignKey
ALTER TABLE "run_field_values" ADD CONSTRAINT "run_field_values_runId_fkey" FOREIGN KEY ("runId") REFERENCES "runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "run_field_values" ADD CONSTRAINT "run_field_values_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "run_field_values" ADD CONSTRAINT "run_field_values_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
