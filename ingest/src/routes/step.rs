use axum::{extract::State, routing::post, Router};
use std::sync::Arc;

use crate::{
    auth::auth, config::METRICS_TABLE_NAME, error::AppError, models::metrics::MetricEnrichment,
    routes::AppState, traits::EnrichmentData,
};

use axum::response::Json;
use clickhouse::sql::Identifier;
use clickhouse::Row;
use serde::{Deserialize, Serialize};

// Structure to hold the result from the ClickHouse query
#[derive(Row, Deserialize, Serialize)]
struct StepRow {
    step: u32, // The maximum step number found
}

// Defines the router for the /step endpoint
pub fn router() -> Router<Arc<AppState>> {
    Router::new().route("/step", post(step))
}

// Handler for the POST /step endpoint
// Retrieves the maximum step number for a specific run from ClickHouse
async fn step(
    State(state): State<Arc<AppState>>,
    headers: axum::http::HeaderMap,
) -> Result<Json<StepRow>, AppError> {
    // Authenticate the request
    let auth = auth(&headers, &state.db).await?;
    let tenant_id = auth.tenant_id;
    // Extract enrichment data (project, run ID) from headers
    let enrichment_data = MetricEnrichment::from_headers(tenant_id.clone(), &headers)?;

    let run_id = enrichment_data.run_id;
    let project_name = enrichment_data.project_name;

    // ClickHouse query to find the maximum step in the metrics table for the given context
    // Uses `?` placeholders for safe parameter binding
    const QUERY: &str =
        "select max(step) as step from ? where tenantId=? and projectName=? and runId=?";

    // Execute the query using the shared ClickHouse client
    let step_row = state
        .clickhouse_client
        .query(QUERY)
        .bind(Identifier(METRICS_TABLE_NAME)) // Bind table name
        .bind(tenant_id) // Bind tenant ID
        .bind(project_name) // Bind project name
        .bind(run_id) // Bind run ID
        .fetch_one::<StepRow>() // Expect exactly one row
        .await?;

    // Return the result as JSON
    Ok(Json(step_row))
}
