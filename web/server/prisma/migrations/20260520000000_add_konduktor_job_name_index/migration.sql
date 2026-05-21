-- Expression index supporting fast Konduktor-job-name lookups against the
-- Runs.systemMetadata JSON column. Powers the `konduktorJobPrefix` filter
-- on GET /api/runs/list — anchored-prefix reverse lookup from a Konduktor
-- job identifier (full hashed ID or YAML base name) to its Pluto run.
-- Without it, the query would seq-scan and extract a JSON path on every
-- row in the org.
--
-- The expression MUST match the SQL Prisma generates for its
-- `{ path: [...], string_starts_with: ... }` JSON filter — otherwise the
-- planner treats the two forms as different expressions and ignores the
-- index. Prisma 5.2 emits the `#>>` text-extractor with a `LIKE 'X%'`
-- comparison, e.g.:
--   ("systemMetadata" #>> ARRAY['konduktor','job_name']::text[]) LIKE 'X%'
-- so the index is built on exactly that text expression, with the
-- `text_pattern_ops` opclass — required for B-tree to accelerate anchored
-- `LIKE 'foo%'` queries regardless of the database's collation.
--
-- Partial (WHERE systemMetadata IS NOT NULL) keeps the index small: only
-- rows that *might* have a konduktor block are indexed.
CREATE INDEX "runs_konduktor_job_name_idx"
  ON "runs" ((("systemMetadata" #>> ARRAY['konduktor', 'job_name']::text[])) text_pattern_ops)
  WHERE "systemMetadata" IS NOT NULL;
