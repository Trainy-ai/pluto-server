CREATE TABLE mlop_data (
    tenantId LowCardinality(String) CODEC(ZSTD(1)),
    projectName String CODEC(ZSTD(1)),
    runId UInt64 CODEC(ZSTD(1)),
    logGroup String CODEC(ZSTD(1)), 
    logName String CODEC(ZSTD(1)),
    dataType LowCardinality(String) CODEC(ZSTD(1)), -- histogram, generic, table
    time DateTime64(3) CODEC(DoubleDelta, LZ4),
    step UInt64 CODEC(DoubleDelta, LZ4),
    data String CODEC(ZSTD(1)),
) ENGINE = MergeTree
ORDER BY (tenantId, projectName, runId, logGroup, logName, time, step);
