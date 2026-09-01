-- Dashboard history is append-only: currentVersion points at the latest
-- immutable name/config snapshot, while restores create a new head.
ALTER TABLE "dashboard_views"
ADD COLUMN "currentVersion" INTEGER NOT NULL DEFAULT 1;

CREATE TABLE "dashboard_view_versions" (
    "id" BIGSERIAL NOT NULL,
    "dashboardViewId" BIGINT NOT NULL,
    "version" INTEGER NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "config" JSONB NOT NULL,
    "createdById" TEXT,
    "source" VARCHAR(32) NOT NULL,
    "restoredFromVersion" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dashboard_view_versions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "dashboard_view_versions_dashboardViewId_version_key"
ON "dashboard_view_versions"("dashboardViewId", "version");

CREATE INDEX "dashboard_view_versions_dashboardViewId_version_idx"
ON "dashboard_view_versions"("dashboardViewId", "version" DESC);

ALTER TABLE "dashboard_view_versions"
ADD CONSTRAINT "dashboard_view_versions_dashboardViewId_fkey"
FOREIGN KEY ("dashboardViewId") REFERENCES "dashboard_views"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "dashboard_view_versions"
ADD CONSTRAINT "dashboard_view_versions_createdById_fkey"
FOREIGN KEY ("createdById") REFERENCES "user"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

-- Existing dashboards become version 1 without rewriting their config. A
-- legacy invalid config can still be inspected, while restore validates it
-- against the current schema before changing the live dashboard.
INSERT INTO "dashboard_view_versions" (
    "dashboardViewId",
    "version",
    "name",
    "config",
    "createdById",
    "source",
    "createdAt"
)
SELECT
    "id",
    1,
    "name",
    "config",
    "createdById",
    'migration',
    "createdAt"
FROM "dashboard_views";
