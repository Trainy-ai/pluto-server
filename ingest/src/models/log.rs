use axum::http::HeaderMap;
use clickhouse::Row;
use serde::{Deserialize, Serialize};

use crate::{
    config::LOGS_TABLE_NAME,
    error::{missing_header_error, AppError, ErrorCode},
    processors::stream::SingleRowInput,
    traits::{DatabaseRow, EnrichmentData, InputData},
};

/// Raw input data for logs
///
/// # Example
/// ```json
/// {
///     "time": 1234567890,
///     "message": "Training started",
///     "lineNumber": 42,
///     "logType": "INFO",
/// }
/// ```
#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LogInput {
    pub time: u64,
    pub message: String,
    #[serde(rename = "lineNumber")]
    pub line_number: u64,
    #[serde(rename = "logType")]
    pub log_type: String,
}

impl LogInput {
    pub fn validate(&self) -> Result<(), AppError> {
        // Validate non-empty strings
        // if self.message.trim().is_empty() {
        //     return Err(AppError::new(
        //         ErrorCode::InvalidLogFormat,
        //         "'message' field cannot be empty".to_string(),
        //     ));
        // }
        if self.log_type.trim().is_empty() {
            return Err(AppError::new(
                ErrorCode::InvalidLogFormat,
                "'logType' field cannot be empty".to_string(),
            ));
        }

        Ok(())
    }
}

impl InputData for LogInput {
    fn validate(&self) -> Result<(), AppError> {
        self.validate()
    }
}

impl SingleRowInput for LogInput {}

#[derive(Debug, Clone)]
pub struct LogEnrichment {
    pub tenant_id: String,
    pub run_id: u64,
    pub project_name: String,
}

impl EnrichmentData for LogEnrichment {
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
pub struct LogRow {
    // Fields from LogInput
    pub time: u64,
    pub message: String,
    #[serde(rename = "lineNumber")]
    pub line_number: u64,
    #[serde(rename = "logType")]
    pub log_type: String,
    // Fields from LogEnrichment
    #[serde(rename = "tenantId")]
    pub tenant_id: String,
    #[serde(rename = "runId")]
    pub run_id: u64,
    #[serde(rename = "projectName")]
    pub project_name: String,
}

impl DatabaseRow<LogInput, LogEnrichment> for LogRow {
    fn from(input: LogInput, enrichment: LogEnrichment) -> Result<Self, AppError> {
        input.validate()?;

        Ok(Self {
            time: input.time,
            message: input.message,
            line_number: input.line_number,
            log_type: input.log_type,
            tenant_id: enrichment.tenant_id,
            run_id: enrichment.run_id,
            project_name: enrichment.project_name,
        })
    }

    fn table_name() -> &'static str {
        LOGS_TABLE_NAME
    }
}
