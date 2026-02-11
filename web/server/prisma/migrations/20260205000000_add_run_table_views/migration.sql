-- CreateTable
CREATE TABLE "run_table_views" (
    "id" BIGSERIAL NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" BIGINT NOT NULL,
    "createdById" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "run_table_views_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "run_table_views_organizationId_projectId_idx" ON "run_table_views"("organizationId", "projectId");

-- CreateIndex
CREATE UNIQUE INDEX "run_table_views_organizationId_projectId_name_key" ON "run_table_views"("organizationId", "projectId", "name");

-- AddForeignKey
ALTER TABLE "run_table_views" ADD CONSTRAINT "run_table_views_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "run_table_views" ADD CONSTRAINT "run_table_views_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "run_table_views" ADD CONSTRAINT "run_table_views_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
