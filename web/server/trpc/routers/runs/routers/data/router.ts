import { router } from "../../../../../lib/trpc";
import { filesProcedure } from "./procs/files";
import { histogramProcedure } from "./procs/histogram";
import { graphProcedure } from "./procs/graph";
import { logsProcedure } from "./procs/logs";
import { modelGraphProcedure } from "./procs/model-graph";
import { tableProcedure } from "./procs/table";
export const dataRouter = router({
  files: filesProcedure,
  histogram: histogramProcedure,
  graph: graphProcedure,
  logs: logsProcedure,
  modelGraph: modelGraphProcedure,
  table: tableProcedure,
});
