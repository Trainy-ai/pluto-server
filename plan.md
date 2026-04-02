# Plan: Neptune-style Run Forking & Inherited Datapoints

## Feature Summary

Add the ability to **fork a run** from a specific step, creating a new run that inherits all metrics/data up to that step. This enables resuming training from a checkpoint while preserving the full experiment lineage on charts.

---

## Key Concepts (adapted from Neptune)

1. **Fork** — Create a new run from an existing run at a specific step. The child run inherits all time-series data (metrics, logs, data) up to and including the fork step, plus optionally config/tags.
2. **Inherited Datapoints** — When viewing a forked run's charts, data points before the fork step come from the parent run. A UI toggle controls whether inherited points are shown.
3. **Lineage** — Runs form a tree. A run can have one parent and many children. Multi-level forking is supported (fork of a fork).

---

## Data Model Changes

### PostgreSQL (Prisma)

Add three new fields to the `Runs` model:

```prisma
model Runs {
  // ... existing fields ...

  // Forking fields
  forkedFromRunId   BigInt?    // Parent run ID (null = root run)
  forkedFromRun     Runs?      @relation("RunForks", fields: [forkedFromRunId], references: [id])
  forks             Runs[]     @relation("RunForks")
  forkStep          BigInt?    // Step at which the fork occurred (null = root run)
}
```

**Why this approach:**
- Lightweight — no data duplication in ClickHouse or S3
- Parent metrics are resolved at **query time** by walking the lineage
- Consistent with Neptune's model where inherited data is virtual, not copied

**Index:** Add index on `forkedFromRunId` for efficient "list forks of run" queries.

### No ClickHouse Schema Changes

Metrics stay where they are. When querying a forked run's metrics with inheritance enabled, we query the lineage chain and stitch results together at the application layer.

---

## API Changes

### 1. HTTP API — Run Creation (`POST /api/runs/create`)

Add optional fields to the create request:

```ts
{
  // ... existing fields ...
  forkRunId?: number    // ID of the run to fork from
  forkStep?: number     // Step to fork at (required if forkRunId is set)
  inheritConfig?: boolean  // Default: true — copy config from parent
  inheritTags?: boolean    // Default: false — copy tags from parent
}
```

**Behavior:**
- Validate that `forkRunId` exists and belongs to the same org+project
- Validate that `forkStep` is a valid step in the parent run (query ClickHouse for max step)
- If `inheritConfig: true`, shallow-copy parent's `config` and `systemMetadata` into child (can be overridden by explicitly provided values)
- If `inheritTags: true`, copy parent's tags
- Store `forkedFromRunId` and `forkStep` on the new run
- Resolve lineage: if forking from a run that was itself forked at a later step, walk down the chain to find the valid parent (Neptune behavior)

### 2. tRPC — New Procedures

**`runs.fork`** (mutation):
```ts
input: {
  runId: string (SQID)
  projectName: string
  forkStep: number
  newRunName?: string  // defaults to "{parentName}-fork-{n}"
  inheritConfig?: boolean  // default true
  inheritTags?: boolean    // default false
}
output: {
  runId: string
  displayId: string
  url: string
}
```

**`runs.getLineage`** (query):
```ts
input: { runId: string (SQID), projectName: string }
output: {
  ancestors: Array<{ runId, displayId, name, forkStep }>  // ordered root → parent
  children: Array<{ runId, displayId, name, forkStep }>   // direct forks
}
```

### 3. Metrics Query — Inherited Datapoints

Modify the existing metrics query (`run-metrics.ts`) to support an `includeInherited: boolean` parameter:

**When `includeInherited: true` (default for forked runs):**
1. Walk the lineage chain from the current run up to the root
2. For each ancestor, query metrics where `step <= forkStep` of the child that forked from it
3. For the current run, query all metrics (no step filter)
4. Stitch together: earliest ancestor's data first, then each successor's data, then current run's data
5. Apply reservoir sampling to the combined result

**Query strategy (single efficient query):**
```sql
-- Build a UNION ALL across the lineage chain
SELECT tenantId, projectName, logGroup, logName, time, step, value, 'inherited' as source
FROM mlop_metrics
WHERE tenantId = ? AND projectName = ? AND runId = ?  -- ancestor run
  AND step <= ?  -- fork step
UNION ALL
SELECT tenantId, projectName, logGroup, logName, time, step, value, 'own' as source
FROM mlop_metrics
WHERE tenantId = ? AND projectName = ? AND runId = ?  -- current run
ORDER BY logName, step ASC
```

For multi-level forks, chain multiple UNION ALL blocks. The lineage is typically shallow (2-5 levels), so this is practical.

**Metric summaries:** Create a new query that merges summaries across the lineage chain (min of mins, max of maxes, weighted avg, etc.).

---

## Frontend Changes

### 1. Fork Action

**Location:** Run detail page actions menu / runs table context menu

- "Fork from step..." action opens a dialog
- Dialog shows: step selector (slider or input), run name input, checkboxes for inherit config/tags
- Step selector shows the metric chart with a draggable vertical line to pick the fork point
- On submit, calls `runs.fork` mutation, then navigates to the new run

### 2. Inherited Datapoints Toggle

**Location:** Chart toolbar (next to existing controls)

- Toggle: "Show inherited metrics" (default: ON for forked runs, hidden for non-forked runs)
- When ON: chart shows full lineage data, with inherited portion in a slightly different style (e.g., dashed line or lower opacity)
- When OFF: chart shows only the run's own data points
- Visual indicator: vertical dashed line at the fork step to show where inheritance ends

### 3. Lineage Visualization

**Location:** Run detail page, new "Lineage" tab or section

- Show parent → child relationships as a simple tree/timeline
- Clickable links to navigate between parent and child runs
- Show fork step for each connection
- Badge on run cards/rows indicating "Forked from {parentName} at step {n}"

### 4. Runs Table

- New optional column: "Forked From" showing parent run link
- Filter: "Show only root runs" / "Show only forked runs"
- Sort by fork step

---

## Implementation Phases

### Phase 1: Data Model & Core API (Backend)
1. Prisma schema migration — add `forkedFromRunId`, `forkStep` fields
2. Update `POST /api/runs/create` to accept fork parameters
3. Add `runs.fork` tRPC mutation
4. Add `runs.getLineage` tRPC query
5. Add lineage-aware metrics query function
6. Tests for all of the above

### Phase 2: Frontend — Fork Action & Basic Display
1. Fork dialog component (step picker, config options)
2. Wire fork action to runs table context menu and run detail page
3. Show "forked from" badge on run detail page
4. Add "Forked From" column option in runs table

### Phase 3: Frontend — Inherited Datapoints on Charts
1. Modify chart data fetching to use lineage-aware metrics query
2. Add "Show inherited metrics" toggle to chart toolbar
3. Visual differentiation of inherited vs own data points (dashed line / opacity)
4. Fork step indicator (vertical line on chart)
5. Merge metric summaries across lineage

### Phase 4: Frontend — Lineage View
1. Lineage tree/timeline visualization component
2. Tab or section on run detail page
3. Navigation between lineage members

---

## Edge Cases & Considerations

1. **Deleted parent run** — If a parent is deleted, the child becomes a root run. `forkedFromRunId` becomes a dangling reference. Options: SET NULL on cascade, or prevent deletion of runs with children (ask user).
2. **Deep lineage chains** — Cap at ~10 levels to prevent expensive queries. Warn user if forking would exceed this.
3. **Cross-project forking** — Not supported initially. Fork must be within the same project.
4. **Permissions** — Fork inherits the project's permissions. User must have write access to the project.
5. **Step validation** — Fork step must exist in the parent run's metrics. Query ClickHouse to validate.
6. **Metric name divergence** — Child run can log new metrics that don't exist in parent. These start from step 0. Inherited metrics toggle only affects metrics that exist in the parent.
7. **Large metric sets** — Reservoir sampling must work across the combined lineage data. Sample after stitching, not before.
8. **SDK support** — Add `fork_run_id` and `fork_step` parameters to the Python SDK's `pluto.init()` in a future phase.

---

## Files to Modify

| File | Change |
|------|--------|
| `web/server/prisma/schema.prisma` | Add forking fields to Runs model |
| `web/server/routes/runs-openapi.ts` | Add fork params to create endpoint |
| `web/server/trpc/routers/runs/router.ts` | Add fork, getLineage procedures |
| `web/server/lib/queries/run-metrics.ts` | Lineage-aware metrics query |
| `web/server/lib/queries/run-details.ts` | Include fork info in run details |
| `web/server/tests/smoke.test.ts` | Tests for fork API |
| `web/app/src/components/charts/` | Inherited datapoints toggle & rendering |
| `web/app/src/routes/` | Fork dialog, lineage view |
| `ingest/docker-setup/sql/` | No changes needed |
