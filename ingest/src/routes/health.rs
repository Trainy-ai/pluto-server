use axum::{routing::get, Router};
use std::sync::Arc;

use crate::routes::AppState;

// Defines the router for the /health endpoint
pub fn router() -> Router<Arc<AppState>> {
    Router::new().route("/health", get(health_check))
}

// Simple health check handler that returns "OK"
async fn health_check() -> &'static str {
    "OK"
}
