use axum::http::HeaderMap;
use clickhouse::Row;
use serde::{de::DeserializeOwned, Serialize};

use crate::error::AppError;

/// Trait for enrichment data that comes from headers
pub trait EnrichmentData: Clone {
    fn from_headers(tenant_id: String, headers: &HeaderMap) -> Result<Self, AppError>;
}

/// Trait for input data that can be validated
pub trait InputData: DeserializeOwned + Send + Sync + 'static + std::fmt::Debug {
    /// Validate the input data
    fn validate(&self) -> Result<(), AppError>;
}

/// Trait for database rows that can be created from input and enrichment data
pub trait DatabaseRow<R, E>:
    DeserializeOwned + std::fmt::Debug + Serialize + Row + Send + 'static + Clone
where
    R: InputData,
    E: EnrichmentData,
{
    fn from(input: R, enrichment: E) -> Result<Self, AppError>;
    fn table_name() -> &'static str;
}

/// Trait for stream processors
pub trait StreamProcessor<R, E, F>
where
    R: InputData,
    E: EnrichmentData,
    F: DatabaseRow<R, E>,
{
    async fn process_stream(
        self,
        headers: HeaderMap,
        body: axum::body::Body,
    ) -> Result<String, AppError>;
}
