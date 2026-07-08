-- Drop the dedicated Runs.group column. Group identity is now encoded as a
-- tag with the `group:` prefix; the v1 dev data was backfilled into tags
-- before this migration ran (see PLAN-grouping-v2.md).
DROP INDEX IF EXISTS "runs_organizationId_projectId_group_idx";
ALTER TABLE "runs" DROP COLUMN IF EXISTS "group";
