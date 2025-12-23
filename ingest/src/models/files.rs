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
        })
    }

    fn table_name() -> &'static str {
        FILES_TABLE_NAME
    }
}
