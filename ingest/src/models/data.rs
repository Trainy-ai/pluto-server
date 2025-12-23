use axum::http::HeaderMap;
use clickhouse::Row;
use serde::{Deserialize, Serialize};

use crate::{
    config::DATA_TABLE_NAME,
    error::{missing_header_error, AppError, ErrorCode},
    processors::stream::SingleRowInput,
    traits::{DatabaseRow, EnrichmentData, InputData},
    utils::log_group_from_log_name,
};

/// Raw input data for data points
///
/// # Example
/// ```json
/// {
///     "time": 1234567890,
///     "data": "Data point recorded",
///     "step": 42,
///     "dataType": "DATA",
///     "logName": "training_log"
/// }
/// ```
#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DataInput {
    pub time: u64,
    pub data: String,
    pub step: u64,
    #[serde(rename = "dataType")]
    pub data_type: String,
    #[serde(rename = "logName")]
    pub log_name: String,
}

impl DataInput {
    pub fn validate(&self) -> Result<(), AppError> {
        if self.data_type.trim().is_empty() {
            return Err(AppError::new(
                ErrorCode::InvalidLogFormat,
                "'dataType' field cannot be empty".to_string(),
            ));
        }

        if self.log_name.trim().is_empty() {
            return Err(AppError::new(
                ErrorCode::InvalidLogFormat,
                "'logName' field cannot be empty".to_string(),
            ));
        }

        Ok(())
    }
}

impl InputData for DataInput {
    fn validate(&self) -> Result<(), AppError> {
        self.validate()
    }
}

impl SingleRowInput for DataInput {}

#[derive(Debug, Clone)]
pub struct DataEnrichment {
    pub tenant_id: String,
    pub run_id: u64,
    pub project_name: String,
}

impl EnrichmentData for DataEnrichment {
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
pub struct DataRow {
    // Fields from DataInput
    pub time: u64,
    pub data: String,
    pub step: u64,
    #[serde(rename = "dataType")]
    pub data_type: String,
    #[serde(rename = "logGroup")]
    pub log_group: String,
    #[serde(rename = "logName")]
    pub log_name: String,
    // Fields from DataEnrichment
    #[serde(rename = "tenantId")]
    pub tenant_id: String,
    #[serde(rename = "runId")]
    pub run_id: u64,
    #[serde(rename = "projectName")]
    pub project_name: String,
}

impl DatabaseRow<DataInput, DataEnrichment> for DataRow {
    fn from(input: DataInput, enrichment: DataEnrichment) -> Result<Self, AppError> {
        input.validate()?;

        let log_group = log_group_from_log_name(&input.log_name);

        Ok(Self {
            time: input.time,
            data: input.data,
            step: input.step,
            data_type: input.data_type,
            log_group,
            log_name: input.log_name,
            tenant_id: enrichment.tenant_id,
            run_id: enrichment.run_id,
            project_name: enrichment.project_name,
        })
    }

    fn table_name() -> &'static str {
        DATA_TABLE_NAME
    }
}
