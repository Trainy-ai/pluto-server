CREATE TABLE mlop_logs (
    tenantId LowCardinality(String) CODEC(ZSTD(1)),
    projectName String CODEC(ZSTD(1)),
    runId UInt64 CODEC(ZSTD(1)),
    logType LowCardinality(String) CODEC(ZSTD(1)), -- info, error, warning, debug, print
    time DateTime64(3) CODEC(DoubleDelta, LZ4),
    lineNumber UInt64 CODEC(DoubleDelta, LZ4),
    message String CODEC(ZSTD(1)),
    -- Misc data
    step UInt64 CODEC(DoubleDelta, LZ4)
) ENGINE = MergeTree
ORDER BY (tenantId, projectName, runId, logType, time, lineNumber);
