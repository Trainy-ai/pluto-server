-- CreateTable
CREATE TABLE "dashboard_views" (
    "id" BIGSERIAL NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" BIGINT NOT NULL,
    "createdById" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "config" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dashboard_views_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "dashboard_views_organizationId_projectId_idx" ON "dashboard_views"("organizationId", "projectId");

-- CreateIndex
CREATE UNIQUE INDEX "dashboard_views_organizationId_projectId_name_key" ON "dashboard_views"("organizationId", "projectId", "name");

-- AddForeignKey
ALTER TABLE "dashboard_views" ADD CONSTRAINT "dashboard_views_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dashboard_views" ADD CONSTRAINT "dashboard_views_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dashboard_views" ADD CONSTRAINT "dashboard_views_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
