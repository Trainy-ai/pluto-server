use axum::{extract::State, http::StatusCode, routing::get, Json, Router};
use serde::Serialize;
use std::sync::Arc;
use std::time::Instant;

use crate::dlq;
use crate::routes::AppState;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VersionInfo {
    service: &'static str,
    version: String,
    git_commit: String,
    git_branch: String,
    build_time: String,
}

#[derive(Serialize)]
pub struct CheckResult {
    pub status: &'static str,
    pub latency_ms: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Serialize)]
pub struct ReadinessResponse {
    pub status: &'static str,
    pub checks: ReadinessChecks,
}

#[derive(Serialize)]
pub struct ReadinessChecks {
    pub clickhouse: CheckResult,
    pub postgres: CheckResult,
}

// Defines the router for the /health endpoint
pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/health", get(health_check))
        .route("/health/ready", get(readiness_check))
        .route("/health/dlq", get(dlq_health))
        .route("/version", get(version_info))
}

// Liveness probe - always returns OK if the process is alive
async fn health_check() -> &'static str {
    "OK"
}

// Readiness probe - verifies database connectivity
async fn readiness_check(
    State(state): State<Arc<AppState>>,
) -> (StatusCode, Json<ReadinessResponse>) {
    // Run checks in parallel
    let (ch_result, pg_result) = tokio::join!(
        async {
            let start = Instant::now();
            let result = state.clickhouse_client.query("SELECT 1").execute().await;
            let latency = start.elapsed().as_millis() as u64;
            match result {
                Ok(_) => CheckResult {
                    status: "up",
                    latency_ms: latency,
                    error: None,
                },
                Err(_) => CheckResult {
                    status: "down",
                    latency_ms: latency,
                    error: Some("ClickHouse health check failed".to_string()),
                },
            }
        },
        async {
            let start = Instant::now();
            let result = state.db.ping().await;
            let latency = start.elapsed().as_millis() as u64;
            match result {
                Ok(_) => CheckResult {
                    status: "up",
                    latency_ms: latency,
                    error: None,
                },
                Err(_) => CheckResult {
                    status: "down",
                    latency_ms: latency,
                    error: Some("PostgreSQL health check failed".to_string()),
                },
            }
        }
    );
    let clickhouse = ch_result;
    let postgres = pg_result;

    let all_healthy = clickhouse.status == "up" && postgres.status == "up";
    let status_code = if all_healthy {
        StatusCode::OK
    } else {
        StatusCode::SERVICE_UNAVAILABLE
    };

    (
        status_code,
        Json(ReadinessResponse {
            status: if all_healthy { "healthy" } else { "unhealthy" },
            checks: ReadinessChecks {
                clickhouse,
                postgres,
            },
        }),
    )
}

// DLQ health check handler that returns statistics
async fn dlq_health(State(state): State<Arc<AppState>>) -> Json<dlq::types::DlqHealthStats> {
    let config = &state.dlq_config;

    if !config.enabled {
        return Json(dlq::types::DlqHealthStats::default());
    }

    // Calculate stats
    let mut stats = dlq::types::DlqHealthStats::default();

    // Count pending batches and records
    for table_name in dlq::DLQ_TABLE_NAMES {
        if let Ok(batches) = dlq::storage::list_batches(&config.base_path, table_name).await {
            stats.batches_pending += batches.len() as u64;

            // Estimate record count from file size (conservative ~1KB/record estimate).
            // NOTE: This is an approximation to keep the health check fast.
            // Reading BatchEnvelope.record_count from each file would be more accurate
            // but requires deserializing potentially thousands of files.
            // Actual record counts are available when replaying batches.
            for batch_path in batches {
                if let Ok(metadata) = tokio::fs::metadata(&batch_path).await {
                    stats.records_pending += (metadata.len() / 1024) as u64;
                }
            }
        }
    }

    // Calculate disk usage
    if let Ok(disk_bytes) = dlq::storage::calculate_disk_usage(&config.base_path).await {
        stats.disk_usage_mb = disk_bytes / 1024 / 1024;
    }

    // Find oldest batch (this would require parsing filenames or reading metadata)
    // For now, we'll skip this calculation to keep the endpoint fast

    Json(stats)
}

// Version info handler that returns build information
async fn version_info() -> Json<VersionInfo> {
    Json(VersionInfo {
        service: "ingest",
        version: std::env::var("SERVICE_VERSION").unwrap_or_else(|_| "unknown".to_string()),
        git_commit: std::env::var("GIT_COMMIT").unwrap_or_else(|_| "unknown".to_string()),
        git_branch: std::env::var("GIT_BRANCH").unwrap_or_else(|_| "unknown".to_string()),
        build_time: std::env::var("BUILD_TIME").unwrap_or_else(|_| "unknown".to_string()),
    })
}
