use axum::http::HeaderMap;
use clickhouse::Row;
use serde::{Deserialize, Serialize};

use crate::{
    config::FILES_TABLE_NAME,
    error::{missing_header_error, AppError},
    processors::stream::SingleRowInput,
    traits::{DatabaseRow, EnrichmentData, InputData},
    utils::log_group_from_log_name,
};

#[derive(Debug, Serialize, Deserialize, Row, Clone)]
pub struct FilesRow {
    #[serde(rename = "tenantId")]
    pub tenant_id: String,
    #[serde(rename = "projectName")]
    pub project_name: String,
    #[serde(rename = "runId")]
    pub run_id: u64,
    #[serde(rename = "time")]
    pub time: u64,
    #[serde(rename = "step")]
    pub step: u64,
    #[serde(rename = "logGroup")]
    pub log_group: String,
    #[serde(rename = "logName")]
    pub log_name: String,
    #[serde(rename = "fileName")]
    pub file_name: String,
    #[serde(rename = "fileType")]
    pub file_type: String,
    #[serde(rename = "fileSize")]
    pub file_size: u64,
    // Optional user-provided caption for media files (image/audio/video).
    // Maps to the Nullable(String) `caption` column in mlop_files.
    // Must stay the last field to match the column order in files.sql.
    // `#[serde(default)]` lets old DLQ envelopes (serialized before this
    // field existed) deserialize cleanly to None.
    #[serde(rename = "caption", default)]
    pub caption: Option<String>,
}

#[derive(Debug, Clone)]
pub struct FilesEnrichment {
    pub tenant_id: String,
    pub run_id: u64,
    pub project_name: String,
}

impl EnrichmentData for FilesEnrichment {
    fn from_headers(tenant_id: String, headers: &HeaderMap) -> Result<Self, AppError> {
        let run_id = headers
            .get("X-Run-Id")
            .and_then(|h| h.to_str().ok())
            .ok_or_else(|| missing_header_error("X-Run-Id"))?
            .parse::<u64>()
            .unwrap();

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

#[derive(Debug, Deserialize, Clone)]
pub struct FileInput {
    pub log_name: String,
    pub file_name: String,
    pub file_type: String,
    pub time: u64,
    pub step: u64,
    pub file_size: u64,
    #[serde(default)]
    pub caption: Option<String>,
}

impl InputData for FileInput {
    fn validate(&self) -> Result<(), AppError> {
        Ok(())
    }
}

impl SingleRowInput for FileInput {}

impl DatabaseRow<FileInput, FilesEnrichment> for FilesRow {
    fn from(input: FileInput, enrichment: FilesEnrichment) -> Result<Self, AppError> {
        input.validate()?;

        let log_group = log_group_from_log_name(&input.log_name);

        Ok(Self {
            tenant_id: enrichment.tenant_id,
            project_name: enrichment.project_name,
            run_id: enrichment.run_id,
            time: input.time,
            step: input.step,
            log_group,
            log_name: input.log_name,
            file_name: input.file_name,
            file_type: input.file_type,
            file_size: input.file_size,
            caption: input.caption,
        })
    }

    fn table_name() -> &'static str {
        FILES_TABLE_NAME
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::traits::DatabaseRow;

    fn make_enrichment() -> FilesEnrichment {
        FilesEnrichment {
            tenant_id: "tenant-1".to_string(),
            run_id: 42,
            project_name: "my-project".to_string(),
        }
    }

    // --- FilesEnrichment from_headers ---

    #[test]
    fn test_files_enrichment_from_valid_headers() {
        let mut headers = HeaderMap::new();
        headers.insert("X-Run-Id", "100".parse().unwrap());
        headers.insert("X-Project-Name", "proj".parse().unwrap());
        let enrichment = FilesEnrichment::from_headers("t1".to_string(), &headers).unwrap();
        assert_eq!(enrichment.tenant_id, "t1");
        assert_eq!(enrichment.run_id, 100);
        assert_eq!(enrichment.project_name, "proj");
    }

    #[test]
    fn test_files_enrichment_missing_run_id() {
        let mut headers = HeaderMap::new();
        headers.insert("X-Project-Name", "proj".parse().unwrap());
        let result = FilesEnrichment::from_headers("t1".to_string(), &headers);
        assert!(result.is_err());
    }

    #[test]
    fn test_files_enrichment_missing_project_name() {
        let mut headers = HeaderMap::new();
        headers.insert("X-Run-Id", "100".parse().unwrap());
        let result = FilesEnrichment::from_headers("t1".to_string(), &headers);
        assert!(result.is_err());
    }

    // --- FilesRow::from ---

    #[test]
    fn test_files_row_from_valid() {
        let input = FileInput {
            log_name: "images/val/epoch_1".to_string(),
            file_name: "sample.png".to_string(),
            file_type: "png".to_string(),
            time: 1000,
            step: 1,
            file_size: 2048,
            caption: Some("a cute cat".to_string()),
        };
        let row =
            <FilesRow as DatabaseRow<FileInput, FilesEnrichment>>::from(input, make_enrichment())
                .unwrap();
        assert_eq!(row.log_group, "images/val");
        assert_eq!(row.log_name, "images/val/epoch_1");
        assert_eq!(row.file_name, "sample.png");
        assert_eq!(row.file_type, "png");
        assert_eq!(row.file_size, 2048);
        assert_eq!(row.tenant_id, "tenant-1");
        assert_eq!(row.run_id, 42);
        assert_eq!(row.caption.as_deref(), Some("a cute cat"));
    }

    #[test]
    fn test_files_row_caption_none_passthrough() {
        let input = FileInput {
            log_name: "images/val".to_string(),
            file_name: "sample.png".to_string(),
            file_type: "png".to_string(),
            time: 1000,
            step: 1,
            file_size: 2048,
            caption: None,
        };
        let row =
            <FilesRow as DatabaseRow<FileInput, FilesEnrichment>>::from(input, make_enrichment())
                .unwrap();
        assert_eq!(row.caption, None);
    }

    #[test]
    fn test_files_row_log_group_no_slash() {
        let input = FileInput {
            log_name: "artifacts".to_string(),
            file_name: "model.pt".to_string(),
            file_type: "pt".to_string(),
            time: 1000,
            step: 1,
            file_size: 1024,
            caption: None,
        };
        let row =
            <FilesRow as DatabaseRow<FileInput, FilesEnrichment>>::from(input, make_enrichment())
                .unwrap();
        assert_eq!(row.log_group, "");
    }

    #[test]
    fn test_files_table_name() {
        assert_eq!(FilesRow::table_name(), "mlop_files");
    }

    // --- FileInput validation ---

    #[test]
    fn test_file_input_always_valid() {
        let input = FileInput {
            log_name: "".to_string(),
            file_name: "".to_string(),
            file_type: "".to_string(),
            time: 0,
            step: 0,
            file_size: 0,
            caption: None,
        };
        assert!(input.validate().is_ok());
    }
}
