#!/bin/bash
set -e 
clickhouse client -n <<-EOSQL
CREATE TABLE mlop_string (tenantId LowCardinality(String) CODEC(ZSTD(1)), projectId String CODEC(ZSTD(1)), time DateTime64(3) CODEC(DoubleDelta, LZ4), metric LowCardinality(String) CODEC(ZSTD(1)), value String CODEC(ZSTD(1))) ENGINE = MergeTree ORDER BY (tenantId, projectId, metric, time);
EOSQL
