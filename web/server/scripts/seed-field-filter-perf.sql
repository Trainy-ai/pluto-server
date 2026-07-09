-- Seed for the "Field-Filter Query Perf Test" Buildkite step.
--
-- Self-contained tenant sized like the largest real project (testing-ci,
-- ~170K runs): 170K runs in one project, five config keys per run in
-- run_field_values. The negated-filter probe (field-filter-perf-probe.ts,
-- same directory) runs against this data. Apply with:
--   psql -U postgres -d mlop_test -v ON_ERROR_STOP=1 -q \
--     < web/server/scripts/seed-field-filter-perf.sql
-- Idempotent: every insert is ON CONFLICT DO NOTHING keyed on fixed ids.

INSERT INTO "organization" (id, name, slug, "createdAt")
VALUES ('field-filter-perf-org', 'Field Filter Perf Org', 'field-filter-perf-org', now())
ON CONFLICT DO NOTHING;

INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
VALUES ('field-filter-perf-user', 'Field Filter Perf', 'field-filter-perf@example.invalid', true, now(), now())
ON CONFLICT DO NOTHING;

INSERT INTO api_key (id, key, name, "keyString", "organizationId", "userId", "createdAt", "isHashed")
VALUES ('field-filter-perf-key', 'mlpi_field_filter_perf_unused', 'field-filter-perf', 'mlpi_...perf', 'field-filter-perf-org', 'field-filter-perf-user', now(), false)
ON CONFLICT DO NOTHING;

INSERT INTO projects (id, name, "organizationId", "createdAt", "updatedAt", "nextRunNumber")
VALUES (999001, 'field-filter-perf', 'field-filter-perf-org', now(), now(), 1)
ON CONFLICT DO NOTHING;

INSERT INTO runs (id, name, "organizationId", "projectId", status, "createdAt", "updatedAt", "createdById", "creatorApiKeyId")
SELECT 900000000 + g, 'perf-run-' || g, 'field-filter-perf-org', 999001,
       'COMPLETED', now() - (g || ' seconds')::interval, now(),
       'field-filter-perf-user', 'field-filter-perf-key'
FROM generate_series(1, 170000) g
ON CONFLICT DO NOTHING;

-- Five keys per run. 'only_on_some_runs' exists on ~10% of runs so the
-- "not exists" probe returns a large set; 'username' cycles 10 values so
-- "is none of" two of them keeps ~80%.
INSERT INTO run_field_values ("runId", "organizationId", "projectId", source, key, "textValue", "numericValue")
SELECT 900000000 + g, 'field-filter-perf-org', 999001, 'config', k.key,
       CASE WHEN k.key = 'username' THEN 'user-' || (g % 10)
            WHEN k.key = 'model' THEN 'model-' || (g % 25)
            WHEN k.key = 'only_on_some_runs' THEN 'x'
            ELSE NULL END,
       CASE WHEN k.key IN ('lr', 'batch_size') THEN (g % 100)::float8 ELSE NULL END
FROM generate_series(1, 170000) g
CROSS JOIN (VALUES ('username'), ('model'), ('lr'), ('batch_size'), ('only_on_some_runs')) AS k(key)
WHERE k.key != 'only_on_some_runs' OR g % 10 = 0
ON CONFLICT DO NOTHING;

ANALYZE runs;
ANALYZE run_field_values;
