CREATE TABLE mlop_files (
    tenantId LowCardinality(String) CODEC(ZSTD(1)),
    projectName String CODEC(ZSTD(1)),
    runId UInt64 CODEC(ZSTD(1)),
    time DateTime64(3) CODEC(DoubleDelta, LZ4),
    step UInt64 CODEC(DoubleDelta, LZ4),
    logGroup String CODEC(ZSTD(1)), 
    logName String CODEC(ZSTD(1)),
    fileName String CODEC(ZSTD(1)),
    fileType LowCardinality(String) CODEC(ZSTD(1)),
    fileSize UInt64 CODEC(ZSTD(1)),
) ENGINE = MergeTree
ORDER BY (tenantId, projectName, runId, logGroup, logName, time, step);
    