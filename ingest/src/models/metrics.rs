use axum::http::HeaderMap;
use clickhouse::Row;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

use crate::{
    config::METRICS_TABLE_NAME,
    error::{missing_header_error, AppError, ErrorCode},
    processors::stream::IntoRows,
    traits::{DatabaseRow, EnrichmentData, InputData},
    utils::log_group_from_log_name,
};

type LogName = String;

/// Raw input data for metrics
///
/// # Example
/// ```json
/// {
///     "time": 1234567890,
///     "step": 42,
///     "data": {
///         "accuracy": 0.95,
///         "loss": 0.123
///     }
/// }
/// ```
#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MetricInput {
    pub time: u64,
    pub step: u64,
    pub data: HashMap<LogName, f64>,
}

impl MetricInput {
    pub fn validate(&self) -> Result<(), AppError> {
        // Validate data map
        if self.data.is_empty() {
            return Err(AppError::new(
                ErrorCode::InvalidMetricFormat,
                "'data' field cannot be empty".to_string(),
            ));
        }

        // Validate each metric
        for (key, value) in &self.data {
            if key.trim().is_empty() {
                return Err(AppError::new(
                    ErrorCode::InvalidMetricFormat,
                    "metric name cannot be empty".to_string(),
                ));
            }
            if !value.is_finite() {
                return Err(AppError::new(
                    ErrorCode::InvalidMetricFormat,
                    format!("metric '{}' has invalid value: {}", key, value),
                ));
            }
        }

        Ok(())
    }
}

impl InputData for MetricInput {
    fn validate(&self) -> Result<(), AppError> {
        self.validate()
    }
}

// Implement IntoRows for MetricInput to handle multiple metrics per input
impl IntoRows<MetricEnrichment, MetricRow> for MetricInput {
    fn into_rows(self, enrichment: MetricEnrichment) -> Result<Vec<MetricRow>, AppError> {
        self.validate()?;

        Ok(self
            .data
            .into_iter()
            .map(|(log_name, value)| MetricRow {
                time: self.time,
                step: self.step,
                log_group: log_group_from_log_name(&log_name),
                log_name,
                value,
                tenant_id: enrichment.tenant_id.clone(),
                run_id: enrichment.run_id.clone(),
                project_name: enrichment.project_name.clone(),
            })
            .collect())
    }
}

#[derive(Debug, Clone)]
pub struct MetricEnrichment {
    pub tenant_id: String,
    pub run_id: u64,
    pub project_name: String,
}

impl EnrichmentData for MetricEnrichment {
    fn from_headers(tenant_id: String, headers: &HeaderMap) -> Result<Self, AppError> {
        let run_id = headers
            .get("X-Run-Id")
            .and_then(|h| h.to_str().ok())
            .ok_or_else(|| missing_header_error("X-Run-Id"))?
            .parse::<u64>()
            .unwrap_or(0);

        let project_name = headers
            .get("X-Project-Name")
            .and_then(|h| h.to_str().ok())
            .ok_or_else(|| missing_header_error("X-Project-Name"))?
            .to_string();

        Ok(Self {
            tenant_id,
            run_id,
            project_name,
        })
    }
}

// Final database row combining input and enrichment
#[derive(Debug, Serialize, Deserialize, Row, Clone)]
pub struct MetricRow {
    // Fields from MetricInput
    pub time: u64,
    pub step: u64,
    #[serde(rename = "logGroup")]
    pub log_group: String,
    #[serde(rename = "logName")]
    pub log_name: LogName,
    pub value: f64,

    // Fields from MetricEnrichment
    #[serde(rename = "tenantId")]
    pub tenant_id: String,
    #[serde(rename = "runId")]
    pub run_id: u64,
    #[serde(rename = "projectName")]
    pub project_name: String,
}

impl DatabaseRow<MetricInput, MetricEnrichment> for MetricRow {
    fn from(input: MetricInput, enrichment: MetricEnrichment) -> Result<Self, AppError> {
        input.validate()?;

        // Take the first metric or return an error if empty
        let (log_name, value) = input.data.into_iter().next().ok_or_else(|| {
            AppError::new(
                ErrorCode::InvalidMetricFormat,
                "'data' field cannot be empty".to_string(),
            )
        })?;

        Ok(Self {
            time: input.time,
            step: input.step,
            log_group: log_group_from_log_name(&log_name),
            log_name,
            value,
            tenant_id: enrichment.tenant_id,
            run_id: enrichment.run_id,
            project_name: enrichment.project_name,
        })
    }

    fn table_name() -> &'static str {
        METRICS_TABLE_NAME
    }
}
