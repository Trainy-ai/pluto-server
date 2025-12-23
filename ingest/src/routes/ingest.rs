use axum::{extract::State, routing::post, Router};
use std::sync::Arc;
use tracing::instrument;

use crate::{
    error::{AppError, ErrorCode},
    models::{
        data::{DataEnrichment, DataInput, DataRow},
        log::{LogEnrichment, LogInput, LogRow},
        metrics::{MetricEnrichment, MetricInput, MetricRow},
    },
    processors::stream::JsonLineProcessor,
    routes::AppState,
    traits::StreamProcessor,
};

// Defines the routes for the /ingest path
pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/ingest/metrics", post(ingest_metrics)) // Route for ingesting metrics
        .route("/ingest/logs", post(ingest_logs)) // Route for ingesting logs
        .route("/ingest/data", post(ingest_data)) // Route for ingesting generic data
}

// Handler for the /ingest/metrics endpoint
#[instrument(skip(state, headers, body))]
async fn ingest_metrics(
    State(state): State<Arc<AppState>>, // Access shared application state
    headers: axum::http::HeaderMap,     // Request headers
    body: axum::body::Body,             // Request body stream
) -> Result<String, AppError> {
    // Create a processor for JSON lines specific to Metric data
    let processor = JsonLineProcessor::<MetricInput, MetricEnrichment, MetricRow>::new(
        state.metrics_record_sender.clone(), // Sender channel for metrics
        state.db.clone(),                    // Database connection
    );
    // Process the incoming stream using the processor
    processor.process_stream(headers, body).await.map_err(|e| {
        // Map processor errors to AppError
        AppError::new(
            ErrorCode::ProcessingFailed,
            format!("Failed to process metrics stream: {}", e),
        )
    })
}

// Handler for the /ingest/logs endpoint
#[instrument(skip(state, headers, body))]
async fn ingest_logs(
    State(state): State<Arc<AppState>>,
    headers: axum::http::HeaderMap,
    body: axum::body::Body,
) -> Result<String, AppError> {
    // Create a processor for JSON lines specific to Log data
    let processor = JsonLineProcessor::<LogInput, LogEnrichment, LogRow>::new(
        state.log_record_sender.clone(), // Sender channel for logs
        state.db.clone(),
    );
    // Process the incoming stream
    processor.process_stream(headers, body).await.map_err(|e| {
        AppError::new(
            ErrorCode::ProcessingFailed,
            format!("Failed to process logs stream: {}", e),
        )
    })
}

// Handler for the /ingest/data endpoint
#[instrument(skip(state, headers, body))]
async fn ingest_data(
    State(state): State<Arc<AppState>>,
    headers: axum::http::HeaderMap,
    body: axum::body::Body,
) -> Result<String, AppError> {
    // Create a processor for JSON lines specific to generic Data
    let processor = JsonLineProcessor::<DataInput, DataEnrichment, DataRow>::new(
        state.data_record_sender.clone(), // Sender channel for data
        state.db.clone(),
    );
    // Process the incoming stream
    processor.process_stream(headers, body).await.map_err(|e| {
        AppError::new(
            ErrorCode::ProcessingFailed,
            format!("Failed to process data stream: {}", e),
        )
    })
}
