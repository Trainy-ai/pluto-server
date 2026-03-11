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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::traits::DatabaseRow;

    fn make_enrichment() -> LogEnrichment {
        LogEnrichment {
            tenant_id: "tenant-1".to_string(),
            run_id: 42,
            project_name: "my-project".to_string(),
        }
    }

    // --- LogInput validation ---

    #[test]
    fn test_valid_log_input() {
        let input = LogInput {
            time: 1000,
            message: "hello".to_string(),
            line_number: 1,
            log_type: "INFO".to_string(),
        };
        assert!(input.validate().is_ok());
    }

    #[test]
    fn test_empty_log_type_rejected() {
        let input = LogInput {
            time: 1000,
            message: "hello".to_string(),
            line_number: 1,
            log_type: "   ".to_string(),
        };
        assert!(input.validate().is_err());
    }

    #[test]
    fn test_empty_message_allowed() {
        let input = LogInput {
            time: 1000,
            message: "".to_string(),
            line_number: 1,
            log_type: "INFO".to_string(),
        };
        assert!(input.validate().is_ok());
    }

    // --- LogInput deserialization ---

    #[test]
    fn test_log_input_deserialization() {
        let json = r#"{"time":1704067200,"message":"Training started","lineNumber":42,"logType":"INFO"}"#;
        let input: LogInput = serde_json::from_str(json).unwrap();
        assert_eq!(input.time, 1704067200);
        assert_eq!(input.message, "Training started");
        assert_eq!(input.line_number, 42);
        assert_eq!(input.log_type, "INFO");
    }

    #[test]
    fn test_log_input_rejects_unknown_fields() {
        let json = r#"{"time":1000,"message":"hi","lineNumber":1,"logType":"INFO","extra":"bad"}"#;
        let result: Result<LogInput, _> = serde_json::from_str(json);
        assert!(result.is_err());
    }

    // --- LogEnrichment from_headers ---

    #[test]
    fn test_enrichment_from_valid_headers() {
        let mut headers = HeaderMap::new();
        headers.insert("X-Run-Id", "123".parse().unwrap());
        headers.insert("X-Project-Name", "test-project".parse().unwrap());
        let enrichment = LogEnrichment::from_headers("tenant-1".to_string(), &headers).unwrap();
        assert_eq!(enrichment.tenant_id, "tenant-1");
        assert_eq!(enrichment.run_id, 123);
        assert_eq!(enrichment.project_name, "test-project");
    }

    #[test]
    fn test_enrichment_missing_run_id() {
        let mut headers = HeaderMap::new();
        headers.insert("X-Project-Name", "test-project".parse().unwrap());
        let result = LogEnrichment::from_headers("tenant-1".to_string(), &headers);
        assert!(result.is_err());
    }

    #[test]
    fn test_enrichment_missing_project_name() {
        let mut headers = HeaderMap::new();
        headers.insert("X-Run-Id", "123".parse().unwrap());
        let result = LogEnrichment::from_headers("tenant-1".to_string(), &headers);
        assert!(result.is_err());
    }

    #[test]
    fn test_enrichment_non_numeric_run_id_defaults_to_zero() {
        let mut headers = HeaderMap::new();
        headers.insert("X-Run-Id", "not-a-number".parse().unwrap());
        headers.insert("X-Project-Name", "test-project".parse().unwrap());
        let enrichment = LogEnrichment::from_headers("tenant-1".to_string(), &headers).unwrap();
        assert_eq!(enrichment.run_id, 0);
    }

    // --- LogRow::from ---

    #[test]
    fn test_log_row_from_valid() {
        let input = LogInput {
            time: 1000,
            message: "test message".to_string(),
            line_number: 5,
            log_type: "ERROR".to_string(),
        };
        let row = <LogRow as DatabaseRow<LogInput, LogEnrichment>>::from(input, make_enrichment()).unwrap();
        assert_eq!(row.time, 1000);
        assert_eq!(row.message, "test message");
        assert_eq!(row.line_number, 5);
        assert_eq!(row.log_type, "ERROR");
        assert_eq!(row.tenant_id, "tenant-1");
        assert_eq!(row.run_id, 42);
        assert_eq!(row.project_name, "my-project");
    }

    #[test]
    fn test_log_row_from_invalid_input() {
        let input = LogInput {
            time: 1000,
            message: "test".to_string(),
            line_number: 1,
            log_type: "".to_string(),
        };
        let result = <LogRow as DatabaseRow<LogInput, LogEnrichment>>::from(input, make_enrichment());
        assert!(result.is_err());
    }

    #[test]
    fn test_log_table_name() {
        assert_eq!(LogRow::table_name(), "mlop_logs");
    }
}
