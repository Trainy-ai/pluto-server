use axum::{extract::State, routing::get, Json, Router};
use std::sync::Arc;

use crate::dlq;
use crate::routes::AppState;

// Defines the router for the /health endpoint
pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/health", get(health_check))
        .route("/health/dlq", get(dlq_health))
}

// Simple health check handler that returns "OK"
async fn health_check() -> &'static str {
    "OK"
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
