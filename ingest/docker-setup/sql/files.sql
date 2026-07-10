CREATE TABLE IF NOT EXISTS mlop_files (
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
    caption Nullable(String) CODEC(ZSTD(1)),
    -- 0-based position of this file within the list logged for one
    -- (logName, step) in a single log() call (wandb-style list logging).
    -- Lets the read path restore the user's sample order instead of
    -- falling back to fileName sort. DEFAULT 0 keeps pre-existing rows
    -- and older-SDK writes (which omit it) back-compatible.
    sampleIndex UInt32 DEFAULT 0 CODEC(ZSTD(1))
) ENGINE = MergeTree
ORDER BY (tenantId, projectName, runId, logGroup, logName, time, step);
