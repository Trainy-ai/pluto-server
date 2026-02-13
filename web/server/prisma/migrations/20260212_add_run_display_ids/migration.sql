-- Add run display ID support (Neptune-style sequential numbering)

-- Add runPrefix and nextRunNumber to projects
ALTER TABLE "projects" ADD COLUMN "runPrefix" VARCHAR(10);
ALTER TABLE "projects" ADD COLUMN "nextRunNumber" INTEGER NOT NULL DEFAULT 1;

-- Add sequential number to runs
ALTER TABLE "runs" ADD COLUMN "number" INTEGER;

-- Unique constraint: run number within a project
CREATE UNIQUE INDEX "runs_projectId_number_key" ON "runs"("projectId", "number");

-- Backfill existing projects with auto-generated prefixes and run numbers
-- For each project, assign sequential numbers to existing runs ordered by createdAt
DO $$
DECLARE
  proj RECORD;
  run_record RECORD;
  counter INTEGER;
  prefix TEXT;
  words TEXT[];
BEGIN
  FOR proj IN SELECT id, name FROM projects LOOP
    -- Generate prefix from project name (first letter of each word, uppercase, max 4 chars)
    words := string_to_array(regexp_replace(proj.name, '[-_.\s]+', ' ', 'g'), ' ');
    IF array_length(words, 1) = 1 THEN
      prefix := upper(left(words[1], 3));
    ELSE
      prefix := '';
      FOR i IN 1..LEAST(array_length(words, 1), 4) LOOP
        prefix := prefix || upper(left(words[i], 1));
      END LOOP;
      -- Pad to at least 2 chars
      IF length(prefix) < 3 AND array_length(words, 1) >= 2 THEN
        prefix := left(prefix, length(prefix) - 1) || upper(left(words[array_length(words, 1)], 3 - length(prefix) + 1));
      END IF;
    END IF;

    -- Update project prefix
    UPDATE projects SET "runPrefix" = prefix WHERE id = proj.id;

    -- Assign sequential numbers to runs
    counter := 1;
    FOR run_record IN
      SELECT id FROM runs WHERE "projectId" = proj.id ORDER BY "createdAt" ASC, id ASC
    LOOP
      UPDATE runs SET "number" = counter WHERE id = run_record.id;
      counter := counter + 1;
    END LOOP;

    -- Update nextRunNumber
    UPDATE projects SET "nextRunNumber" = counter WHERE id = proj.id;
  END LOOP;
END $$;
