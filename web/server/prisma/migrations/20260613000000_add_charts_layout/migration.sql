-- CreateTable
-- Persisted layout overlay for the default "Charts" (All Metrics) view.
-- One shared row per project storing the user-arranged metric-group order
-- plus collapsed/hidden group keys.
CREATE TABLE "charts_layouts" (
    "id" BIGSERIAL NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" BIGINT NOT NULL,
    "updatedById" TEXT,
    "config" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "charts_layouts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- Unique index doubles as the lookup index for (organizationId, projectId).
CREATE UNIQUE INDEX "charts_layouts_organizationId_projectId_key" ON "charts_layouts"("organizationId", "projectId");

-- AddForeignKey
ALTER TABLE "charts_layouts" ADD CONSTRAINT "charts_layouts_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "charts_layouts" ADD CONSTRAINT "charts_layouts_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "charts_layouts" ADD CONSTRAINT "charts_layouts_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
