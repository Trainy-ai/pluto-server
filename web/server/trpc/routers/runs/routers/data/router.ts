import { router } from "../../../../../lib/trpc";
import { filesProcedure } from "./procs/files";
import { filesBatchProcedure } from "./procs/files-batch";
import { fileTreeProcedure } from "./procs/file-tree";
import { fileUrlProcedure } from "./procs/file-url";
import { histogramProcedure } from "./procs/histogram";
import { histogramBatchProcedure } from "./procs/histogram-batch";
import { barsDataProcedure } from "./procs/bars-data";
import { barsDataBatchProcedure } from "./procs/bars-data-batch";
import { eligiblePrefixesProcedure } from "./procs/eligible-prefixes";
import { graphProcedure } from "./procs/graph";
import { graphBatchProcedure } from "./procs/graph-batch";
import { graphBucketedProcedure } from "./procs/graph-bucketed";
import { graphBatchBucketedProcedure } from "./procs/graph-batch-bucketed";
import { graphMultiMetricBatchBucketedProcedure } from "./procs/graph-multi-metric-batch-bucketed";
import { graphMultiMetricBatchBucketedGroupedProcedure } from "./procs/graph-multi-metric-batch-bucketed-grouped";
import { logsProcedure } from "./procs/logs";
import { modelGraphProcedure } from "./procs/model-graph";
import { tableProcedure } from "./procs/table";
import { metricValuesProcedure } from "./procs/metric-values";
export const dataRouter = router({
  files: filesProcedure,
  filesBatch: filesBatchProcedure,
  fileTree: fileTreeProcedure,
  fileUrl: fileUrlProcedure,
  histogram: histogramProcedure,
  histogramBatch: histogramBatchProcedure,
  barsData: barsDataProcedure,
  barsDataBatch: barsDataBatchProcedure,
  eligiblePrefixes: eligiblePrefixesProcedure,
  graph: graphProcedure,
  graphBatch: graphBatchProcedure,
  graphBucketed: graphBucketedProcedure,
  graphBatchBucketed: graphBatchBucketedProcedure,
  graphMultiMetricBatchBucketed: graphMultiMetricBatchBucketedProcedure,
  graphMultiMetricBatchBucketedGrouped: graphMultiMetricBatchBucketedGroupedProcedure,
  logs: logsProcedure,
  modelGraph: modelGraphProcedure,
  table: tableProcedure,
  metricValues: metricValuesProcedure,
});
