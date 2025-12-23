#!/bin/bash
set -e 
clickhouse client -n <<-EOSQL
CREATE TABLE mlop_artifact (tenantId LowCardinality(String) CODEC(ZSTD(1)), projectId String CODEC(ZSTD(1)), time DateTime64(3) CODEC(DoubleDelta, LZ4), artifact_name String CODEC(ZSTD(1)), artfact_file_name String CODEC(ZSTD(1)), artifact_file_extension LowCardinality(String) CODEC(ZSTD(1))) ENGINE = MergeTree ORDER BY (tenantId, projectId);
EOSQL
