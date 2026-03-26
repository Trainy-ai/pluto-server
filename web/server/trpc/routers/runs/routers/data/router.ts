import { router } from "../../../../../lib/trpc";
import { filesProcedure } from "./procs/files";
import { fileTreeProcedure } from "./procs/file-tree";
import { fileUrlProcedure } from "./procs/file-url";
import { histogramProcedure } from "./procs/histogram";
import { graphProcedure } from "./procs/graph";
import { graphBatchProcedure } from "./procs/graph-batch";
import { graphBucketedProcedure } from "./procs/graph-bucketed";
import { graphBatchBucketedProcedure } from "./procs/graph-batch-bucketed";
import { graphMultiMetricBatchBucketedProcedure } from "./procs/graph-multi-metric-batch-bucketed";
import { logsProcedure } from "./procs/logs";
import { modelGraphProcedure } from "./procs/model-graph";
import { tableProcedure } from "./procs/table";
import { metricValuesProcedure } from "./procs/metric-values";
export const dataRouter = router({
  files: filesProcedure,
  fileTree: fileTreeProcedure,
  fileUrl: fileUrlProcedure,
  histogram: histogramProcedure,
  graph: graphProcedure,
  graphBatch: graphBatchProcedure,
  graphBucketed: graphBucketedProcedure,
  graphBatchBucketed: graphBatchBucketedProcedure,
  graphMultiMetricBatchBucketed: graphMultiMetricBatchBucketedProcedure,
  logs: logsProcedure,
  modelGraph: modelGraphProcedure,
  table: tableProcedure,
  metricValues: metricValuesProcedure,
});
