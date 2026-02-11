CREATE TABLE IF NOT EXISTS mlop_metric_summaries (
    tenantId      LowCardinality(String) CODEC(ZSTD(1)),
    projectName   String                 CODEC(ZSTD(1)),
    runId         UInt64                 CODEC(ZSTD(1)),
    logName       String                 CODEC(ZSTD(1)),
    min_value     SimpleAggregateFunction(min, Float64),
    max_value     SimpleAggregateFunction(max, Float64),
    sum_value     SimpleAggregateFunction(sum, Float64),
    count_value   SimpleAggregateFunction(sum, UInt64),
    last_value    AggregateFunction(argMax, Float64, UInt64),
    sum_sq_value  SimpleAggregateFunction(sum, Float64)
) ENGINE = AggregatingMergeTree()
ORDER BY (tenantId, projectName, logName, runId)
