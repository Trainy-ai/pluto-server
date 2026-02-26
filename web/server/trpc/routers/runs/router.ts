import { router } from "../../../lib/trpc";

import { getRunProcedure } from "./procs/get-run";
import { listRunsProcedure } from "./procs/list-runs";
import { latestRunsProcedure } from "./procs/latest-runs";
import { dataRouter } from "./routers/data/router";
import { triggerRouter } from "./routers/trigger/router";
import { countRunsProcedure } from "./procs/runs-count";
import { updateTagsProcedure } from "./procs/update-tags";
import { updateNotesProcedure } from "./procs/update-notes";
import { distinctTagsProcedure } from "./procs/distinct-tags";
import { distinctColumnKeysProcedure, searchColumnKeysProcedure } from "./procs/distinct-column-keys";
import { getLogsByRunIdsProcedure } from "./procs/get-logs-by-run-ids";
import { getFieldValuesProcedure } from "./procs/get-field-values";
import { distinctMetricNamesProcedure } from "./procs/distinct-metric-names";
import { distinctFileLogNamesProcedure } from "./procs/distinct-file-log-names";
import { metricSummariesProcedure } from "./procs/metric-summaries";

export const runsRouter = router({
  // Procedures
  list: listRunsProcedure,
  get: getRunProcedure,
  latest: latestRunsProcedure,
  count: countRunsProcedure,
  updateTags: updateTagsProcedure,
  updateNotes: updateNotesProcedure,
  distinctTags: distinctTagsProcedure,
  distinctColumnKeys: distinctColumnKeysProcedure,
  searchColumnKeys: searchColumnKeysProcedure,
  getLogsByRunIds: getLogsByRunIdsProcedure,
  getFieldValues: getFieldValuesProcedure,
  distinctMetricNames: distinctMetricNamesProcedure,
  distinctFileLogNames: distinctFileLogNamesProcedure,
  metricSummaries: metricSummariesProcedure,
  // Routers
  data: dataRouter,
  trigger: triggerRouter,
});
