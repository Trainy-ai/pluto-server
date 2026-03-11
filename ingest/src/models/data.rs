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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::traits::DatabaseRow;

    fn make_enrichment() -> DataEnrichment {
        DataEnrichment {
            tenant_id: "tenant-1".to_string(),
            run_id: 42,
            project_name: "my-project".to_string(),
        }
    }

    // --- DataInput validation ---

    #[test]
    fn test_valid_data_input() {
        let input = DataInput {
            time: 1000,
            data: r#"{"bins": [1,2,3]}"#.to_string(),
            step: 1,
            data_type: "histogram".to_string(),
            log_name: "train/loss".to_string(),
        };
        assert!(input.validate().is_ok());
    }

    #[test]
    fn test_empty_data_type_rejected() {
        let input = DataInput {
            time: 1000,
            data: "test".to_string(),
            step: 1,
            data_type: "  ".to_string(),
            log_name: "train/loss".to_string(),
        };
        assert!(input.validate().is_err());
    }

    #[test]
    fn test_empty_log_name_rejected() {
        let input = DataInput {
            time: 1000,
            data: "test".to_string(),
            step: 1,
            data_type: "histogram".to_string(),
            log_name: "  ".to_string(),
        };
        assert!(input.validate().is_err());
    }

    // --- DataInput deserialization ---

    #[test]
    fn test_data_input_deserialization() {
        let json = r#"{"time":1000,"data":"payload","step":5,"dataType":"table","logName":"results/eval"}"#;
        let input: DataInput = serde_json::from_str(json).unwrap();
        assert_eq!(input.time, 1000);
        assert_eq!(input.data, "payload");
        assert_eq!(input.step, 5);
        assert_eq!(input.data_type, "table");
        assert_eq!(input.log_name, "results/eval");
    }

    #[test]
    fn test_data_input_rejects_unknown_fields() {
        let json = r#"{"time":1000,"data":"x","step":1,"dataType":"t","logName":"l","extra":true}"#;
        let result: Result<DataInput, _> = serde_json::from_str(json);
        assert!(result.is_err());
    }

    // --- DataEnrichment from_headers ---

    #[test]
    fn test_data_enrichment_from_valid_headers() {
        let mut headers = HeaderMap::new();
        headers.insert("X-Run-Id", "999".parse().unwrap());
        headers.insert("X-Project-Name", "my-proj".parse().unwrap());
        let enrichment = DataEnrichment::from_headers("t1".to_string(), &headers).unwrap();
        assert_eq!(enrichment.tenant_id, "t1");
        assert_eq!(enrichment.run_id, 999);
        assert_eq!(enrichment.project_name, "my-proj");
    }

    #[test]
    fn test_data_enrichment_missing_headers() {
        let headers = HeaderMap::new();
        let result = DataEnrichment::from_headers("t1".to_string(), &headers);
        assert!(result.is_err());
    }

    // --- DataRow::from ---

    #[test]
    fn test_data_row_from_valid() {
        let input = DataInput {
            time: 1000,
            data: "payload".to_string(),
            step: 5,
            data_type: "histogram".to_string(),
            log_name: "train/loss/hist".to_string(),
        };
        let row = <DataRow as DatabaseRow<DataInput, DataEnrichment>>::from(input, make_enrichment()).unwrap();
        assert_eq!(row.log_group, "train/loss");
        assert_eq!(row.log_name, "train/loss/hist");
        assert_eq!(row.data_type, "histogram");
        assert_eq!(row.tenant_id, "tenant-1");
        assert_eq!(row.run_id, 42);
    }

    #[test]
    fn test_data_row_log_group_no_slash() {
        let input = DataInput {
            time: 1000,
            data: "payload".to_string(),
            step: 1,
            data_type: "table".to_string(),
            log_name: "simple_name".to_string(),
        };
        let row = <DataRow as DatabaseRow<DataInput, DataEnrichment>>::from(input, make_enrichment()).unwrap();
        assert_eq!(row.log_group, "");
    }

    #[test]
    fn test_data_table_name() {
        assert_eq!(DataRow::table_name(), "mlop_data");
    }
}
