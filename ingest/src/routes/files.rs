use aws_config::meta::region::RegionProviderChain;
use aws_sdk_s3::config::Credentials;
use aws_sdk_s3::presigning::PresigningConfig;
use aws_sdk_s3::Client;
use aws_types::region::Region;
use axum::{extract::State, routing::post, Json};
use futures::future::join_all;
use serde::de::{self, Deserializer, Visitor};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fmt;
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime};

use crate::{
    auth::auth,
    error::{AppError, ErrorCode},
    models::files::{FileInput, FilesEnrichment, FilesRow},
    routes::AppState,
    traits::{DatabaseRow, EnrichmentData},
};

// Enum representing supported file types and their MIME types
#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "snake_case")]
pub enum FileType {
    // Images
    Jpeg,
    Jpg,
    Png,
    Gif,
    Svg,
    Webp,
    // Videos
    Mp4,
    Webm,
    Avi,
    Mov,
    // Audio
    Mp3,
    Wav,
    Ogg,
    // Documents
    Pdf,
    Doc,
    Docx,
    Xls,
    Xlsx,
    Txt,
    Log,
    // Data
    Json,
    Csv,
    Xml,
    Yaml,
    // ML specific
    Onnx,
    Pkl,
    H5,
    TfLite,
    SavedModel,
    Pt,
    Ckpt,
    // Custom type for any other MIME type
    Custom(String),
}

impl FileType {
    // Returns the standard MIME type string for the file type
    pub fn mime_type(&self) -> String {
        match self {
            // Images
            FileType::Jpeg => "image/jpeg".to_string(),
            FileType::Jpg => "image/jpeg".to_string(),
            FileType::Png => "image/png".to_string(),
            FileType::Gif => "image/gif".to_string(),
            FileType::Svg => "image/svg+xml".to_string(),
            FileType::Webp => "image/webp".to_string(),
            // Videos
            FileType::Mp4 => "video/mp4".to_string(),
            FileType::Webm => "video/webm".to_string(),
            FileType::Avi => "video/x-msvideo".to_string(),
            FileType::Mov => "video/quicktime".to_string(),
            // Audio
            FileType::Mp3 => "audio/mpeg".to_string(),
            FileType::Wav => "audio/x-wav".to_string(), // TODO: fix all mimetypes
            FileType::Ogg => "audio/ogg".to_string(),
            // Documents
            FileType::Pdf => "application/pdf".to_string(),
            FileType::Doc => "application/msword".to_string(),
            FileType::Docx => {
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                    .to_string()
            }
            FileType::Xls => "application/vnd.ms-excel".to_string(),
            FileType::Xlsx => {
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet".to_string()
            }
            FileType::Txt | FileType::Log => "text/plain".to_string(),
            // Data
            FileType::Json => "application/json".to_string(),
            FileType::Csv => "text/csv".to_string(),
            FileType::Xml => "application/xml".to_string(),
            FileType::Yaml => "application/x-yaml".to_string(),
            // ML specific
            FileType::Onnx => "application/octet-stream".to_string(),
            FileType::Pkl => "application/octet-stream".to_string(),
            FileType::H5 => "application/x-hdf5".to_string(),
            FileType::TfLite => "application/octet-stream".to_string(),
            FileType::SavedModel => "application/octet-stream".to_string(),
            FileType::Pt => "application/octet-stream".to_string(),
            FileType::Ckpt => "application/octet-stream".to_string(),
            // Custom
            FileType::Custom(mime_type) => mime_type.clone(),
        }
    }

    // Returns the common file extension for the file type
    #[allow(dead_code)]
    pub fn extension(&self) -> String {
        match self {
            // Images
            FileType::Jpeg => "jpeg".to_string(),
            FileType::Jpg => "jpg".to_string(),
            FileType::Png => "png".to_string(),
            FileType::Gif => "gif".to_string(),
            FileType::Svg => "svg".to_string(),
            FileType::Webp => "webp".to_string(),
            // Videos
            FileType::Mp4 => "mp4".to_string(),
            FileType::Webm => "webm".to_string(),
            FileType::Avi => "avi".to_string(),
            FileType::Mov => "mov".to_string(),
            // Audio
            FileType::Mp3 => "mp3".to_string(),
            FileType::Wav => "wav".to_string(),
            FileType::Ogg => "ogg".to_string(),
            // Documents
            FileType::Pdf => "pdf".to_string(),
            FileType::Doc => "doc".to_string(),
            FileType::Docx => "docx".to_string(),
            FileType::Xls => "xls".to_string(),
            FileType::Xlsx => "xlsx".to_string(),
            FileType::Txt => "txt".to_string(),
            FileType::Log => "log".to_string(),
            // Data
            FileType::Json => "json".to_string(),
            FileType::Csv => "csv".to_string(),
            FileType::Xml => "xml".to_string(),
            FileType::Yaml => "yaml".to_string(),
            // ML specific
            FileType::Onnx => "onnx".to_string(),
            FileType::Pkl => "pkl".to_string(),
            FileType::H5 => "h5".to_string(),
            FileType::TfLite => "tflite".to_string(),
            FileType::SavedModel => "savedmodel".to_string(),
            FileType::Pt => "pt".to_string(),
            FileType::Ckpt => "ckpt".to_string(),
            // Custom - return the original extension
            FileType::Custom(ext) => ext.clone(),
        }
    }

    // Helper function to create FileType from a string (usually file extension)
    fn from_str(s: &str) -> Option<FileType> {
        match s.to_lowercase().as_str() {
            // Images
            "jpeg" => Some(FileType::Jpeg),
            "jpg" => Some(FileType::Jpg),
            "png" => Some(FileType::Png),
            "gif" => Some(FileType::Gif),
            "svg" => Some(FileType::Svg),
            "webp" => Some(FileType::Webp),
            // Videos
            "mp4" => Some(FileType::Mp4),
            "webm" => Some(FileType::Webm),
            "avi" => Some(FileType::Avi),
            "mov" => Some(FileType::Mov),
            // Audio
            "mp3" => Some(FileType::Mp3),
            "wav" => Some(FileType::Wav),
            "ogg" => Some(FileType::Ogg),
            // Documents
            "pdf" => Some(FileType::Pdf),
            "doc" => Some(FileType::Doc),
            "docx" => Some(FileType::Docx),
            "xls" => Some(FileType::Xls),
            "xlsx" => Some(FileType::Xlsx),
            "txt" => Some(FileType::Txt),
            "log" => Some(FileType::Log),
            // Data
            "json" => Some(FileType::Json),
            "csv" => Some(FileType::Csv),
            "xml" => Some(FileType::Xml),
            "yaml" | "yml" => Some(FileType::Yaml),
            // ML specific
            "onnx" => Some(FileType::Onnx),
            "pkl" => Some(FileType::Pkl),
            "h5" => Some(FileType::H5),
            "tflite" => Some(FileType::TfLite),
            "savedmodel" => Some(FileType::SavedModel),
            "pt" => Some(FileType::Pt),
            "ckpt" => Some(FileType::Ckpt),
            // If not a known extension, treat as custom mime type
            _ => Some(FileType::Custom(s.to_string())),
        }
    }
}

// Custom deserializer for FileType
// Allows deserializing from a simple string (e.g., "png")
// or an object like `{"custom": "application/octet-stream"}`
impl<'de> Deserialize<'de> for FileType {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        struct FileTypeVisitor;

        impl<'de> Visitor<'de> for FileTypeVisitor {
            type Value = FileType;

            fn expecting(&self, formatter: &mut fmt::Formatter) -> fmt::Result {
                formatter.write_str("a string or an object with 'custom' field")
            }

            fn visit_str<E>(self, value: &str) -> Result<FileType, E>
            where
                E: de::Error,
            {
                Ok(
                    FileType::from_str(value)
                        .unwrap_or_else(|| FileType::Custom(value.to_string())),
                )
            }

            fn visit_map<A>(self, mut map: A) -> Result<FileType, A::Error>
            where
                A: de::MapAccess<'de>,
            {
                #[derive(Deserialize)]
                struct CustomType {
                    custom: String,
                }

                let custom: CustomType =
                    Deserialize::deserialize(de::value::MapAccessDeserializer::new(&mut map))?;
                Ok(FileType::Custom(custom.custom))
            }
        }

        deserializer.deserialize_any(FileTypeVisitor)
    }
}

// Request body structure for requesting file upload URLs
#[derive(Debug, Deserialize, Clone)]
pub struct FileUploadRequest {
    // List of files to be uploaded
    pub files: Vec<FileUploadInfo>,
}

// Information about a single file to be uploaded
#[derive(Debug, Deserialize, Clone)]
pub struct FileUploadInfo {
    #[serde(rename = "fileName")]
    pub file_name: String, // Original name of the file
    #[serde(rename = "logName")]
    pub log_name: String, // Logical grouping or category for the file (e.g., "val/epoch")
    #[serde(rename = "fileSize")]
    pub file_size: u64, // Size of the file in bytes
    #[serde(rename = "fileType")]
    pub file_type: FileType, // Type of the file (used for Content-Type)
    pub step: u64, // Step associated with the file (e.g., training step)
    pub time: u64, // Timestamp associated with the file
}

/// Response containing presigned URLs for requested files
/// Grouped by log_name
/// Example:
/// {
///         "val/epoch": [
///             {
///                 "file.txt": "https://example.com
///             }
///         ]
/// }
#[derive(Debug, Serialize)]
pub struct PresignedUrlResponse {
    // Maps log_name to a list of {file_name: presigned_url} maps
    #[serde(flatten)]
    pub log_files: HashMap<String, Vec<HashMap<String, String>>>,
}

// Handler for the POST /files endpoint
// Generates presigned URLs for S3/R2 uploads
pub async fn generate_presigned_urls(
    State(state): State<Arc<AppState>>,
    headers: axum::http::HeaderMap,
    Json(payload): Json<FileUploadRequest>,
) -> Result<Json<PresignedUrlResponse>, AppError> {
    let req_start = Instant::now();
    // Authenticate the request using headers and database
    let auth = auth(&headers, &state.db).await?;
    let tenant_id = auth.tenant_id;

    let enrichment_start = Instant::now();

    // Extract enrichment data (like run_id, project_name) from headers
    let enrichment_data = FilesEnrichment::from_headers(tenant_id.clone(), &headers)?;
    let run_id = enrichment_data.run_id.clone();
    let project_name = enrichment_data.project_name.clone();

    println!("[FILES] Payload \n {:?}", payload);
    println!("[FILES] Enrichment time: {:?}", enrichment_start.elapsed());

    let send_start = Instant::now();

    // Send metadata about each file to the background processor via channel
    for file in payload.files.iter() {
        let file_input = FileInput {
            log_name: file.log_name.clone(),
            file_name: file.file_name.clone(),
            file_type: file.file_type.extension(), // Use file extension for storage record
            time: file.time,
            file_size: file.file_size,
            step: file.step,
        };

        // Create the full database row structure
        let files_row = <FilesRow as DatabaseRow<FileInput, FilesEnrichment>>::from(
            file_input,
            enrichment_data.clone(),
        )?;
        // Send the row to the files background processor
        state
            .files_record_sender
            .send(files_row)
            .await
            .map_err(|e| AppError::new(ErrorCode::InternalError, e.to_string()))?;
    }

    println!("[FILES] Send time: {:?}", send_start.elapsed());

    // Setup S3/R2 client configuration using credentials from app config
    let region_provider =
        RegionProviderChain::first_try(Region::new(state.config.storage_region.clone()));
    let mut config_builder = aws_config::from_env()
        .region(region_provider)
        .credentials_provider(Credentials::new(
            state.config.storage_access_key_id.as_str(),
            state.config.storage_secret_access_key.as_str(),
            None,
            None,
            "storage_config",
        ));

    // Only set endpoint_url for non-AWS S3 (MinIO, R2, etc.)
    // AWS S3 handles virtual-hosted style automatically; setting endpoint_url
    // causes signature mismatch between path-style and virtual-hosted URLs
    if !state.config.storage_endpoint.to_lowercase().contains("amazonaws.com") {
        config_builder = config_builder.endpoint_url(state.config.storage_endpoint.as_str());
    }

    let shared_config = config_builder.load().await;

    let s3_client: Arc<Client> = Arc::new(Client::new(&shared_config));

    // Build a presigning config with a defined expiry and explicit start time
    // Using explicit start_time helps mitigate potential clock skew issues
    let presigning_config = Arc::new(
        PresigningConfig::builder()
            .expires_in(Duration::from_secs(3600)) // URLs valid for 1 hour
            .start_time(SystemTime::now())
            .build()
            .expect("Failed to create presigning config"),
    );

    // Generate presigned URLs concurrently for better performance
    let start = Instant::now();
    let url_futures = payload.files.into_iter().map(|file| {
        // Clone Arcs for use in the async block
        let s3: Arc<Client> = Arc::clone(&s3_client);
        let cfg: Arc<PresigningConfig> = Arc::clone(&presigning_config);
        let tenant = tenant_id.clone();
        let project = project_name.clone();
        let run = run_id.clone();

        let storage_bucket = state.config.storage_bucket.clone();

        async move {
            // Construct the S3 object key using tenant, project, run, log, and file names
            let key = format!(
                "{}/{}/{}/{}/{}",
                tenant, project, run, file.log_name, file.file_name
            );

            // Build the PutObject request with just bucket and key
            // Note: content_type and content_length are intentionally NOT included
            // in the presigned URL signature because the client may send different
            // values, causing SignatureDoesNotMatch errors
            let req = s3
                .put_object()
                .bucket(storage_bucket.as_str())
                .key(key);

            // Generate the presigned URL for the PutObject request
            let presigned = req
                .presigned((*cfg).clone())
                .await
                .map_err(|e| AppError::new(ErrorCode::InternalError, e.to_string()))?;

            // Return the log name, file name, and the generated URL
            Ok::<_, AppError>((file.log_name, file.file_name, presigned.uri().to_string()))
        }
    });

    // Wait for all presigned URL generation tasks to complete
    let results = join_all(url_futures).await;
    let duration = start.elapsed();
    println!("[FILES] Generated presigned URLs in {:?}", duration);

    // Process the results, grouping URLs by log_name
    let mut log_files: HashMap<String, Vec<HashMap<String, String>>> = HashMap::new();
    for result in results {
        let (log_name, file_name, url) = result?;
        let file_map = HashMap::from([(file_name, url)]);
        log_files.entry(log_name).or_default().push(file_map);
    }

    println!("[FILES] Total time: {:?}", req_start.elapsed());

    // Return the response containing the grouped presigned URLs
    Ok(Json(PresignedUrlResponse { log_files }))
}

// Defines the router for the /files endpoint
pub fn router() -> axum::Router<Arc<AppState>> {
    axum::Router::new().route("/files", post(generate_presigned_urls))
}

#[cfg(test)]
mod tests {
    use super::*;

    // --- FileType::from_str ---

    #[test]
    fn test_file_type_from_str_known_types() {
        assert!(matches!(FileType::from_str("png"), Some(FileType::Png)));
        assert!(matches!(FileType::from_str("jpg"), Some(FileType::Jpg)));
        assert!(matches!(FileType::from_str("jpeg"), Some(FileType::Jpeg)));
        assert!(matches!(FileType::from_str("mp4"), Some(FileType::Mp4)));
        assert!(matches!(FileType::from_str("csv"), Some(FileType::Csv)));
        assert!(matches!(FileType::from_str("json"), Some(FileType::Json)));
        assert!(matches!(FileType::from_str("pt"), Some(FileType::Pt)));
        assert!(matches!(FileType::from_str("onnx"), Some(FileType::Onnx)));
        assert!(matches!(FileType::from_str("h5"), Some(FileType::H5)));
        assert!(matches!(FileType::from_str("pkl"), Some(FileType::Pkl)));
    }

    #[test]
    fn test_file_type_from_str_case_insensitive() {
        assert!(matches!(FileType::from_str("PNG"), Some(FileType::Png)));
        assert!(matches!(FileType::from_str("Jpg"), Some(FileType::Jpg)));
        assert!(matches!(FileType::from_str("CSV"), Some(FileType::Csv)));
    }

    #[test]
    fn test_file_type_from_str_yaml_aliases() {
        assert!(matches!(FileType::from_str("yaml"), Some(FileType::Yaml)));
        assert!(matches!(FileType::from_str("yml"), Some(FileType::Yaml)));
    }

    #[test]
    fn test_file_type_from_str_unknown_returns_custom() {
        match FileType::from_str("xyz123") {
            Some(FileType::Custom(s)) => assert_eq!(s, "xyz123"),
            other => panic!("Expected Custom, got {:?}", other),
        }
    }

    // --- FileType::mime_type ---

    #[test]
    fn test_mime_types() {
        assert_eq!(FileType::Png.mime_type(), "image/png");
        assert_eq!(FileType::Jpeg.mime_type(), "image/jpeg");
        assert_eq!(FileType::Jpg.mime_type(), "image/jpeg");
        assert_eq!(FileType::Mp4.mime_type(), "video/mp4");
        assert_eq!(FileType::Mp3.mime_type(), "audio/mpeg");
        assert_eq!(FileType::Pdf.mime_type(), "application/pdf");
        assert_eq!(FileType::Json.mime_type(), "application/json");
        assert_eq!(FileType::Csv.mime_type(), "text/csv");
        assert_eq!(FileType::Txt.mime_type(), "text/plain");
        assert_eq!(FileType::Log.mime_type(), "text/plain");
        assert_eq!(FileType::Onnx.mime_type(), "application/octet-stream");
        assert_eq!(FileType::Pt.mime_type(), "application/octet-stream");
        assert_eq!(
            FileType::Custom("video/x-custom".to_string()).mime_type(),
            "video/x-custom"
        );
    }

    // --- FileType::extension ---

    #[test]
    fn test_extensions() {
        assert_eq!(FileType::Png.extension(), "png");
        assert_eq!(FileType::Jpeg.extension(), "jpeg");
        assert_eq!(FileType::Jpg.extension(), "jpg");
        assert_eq!(FileType::Ckpt.extension(), "ckpt");
        assert_eq!(FileType::SavedModel.extension(), "savedmodel");
        assert_eq!(FileType::Custom("bin".to_string()).extension(), "bin");
    }

    // --- FileType deserialization ---

    #[test]
    fn test_deserialize_file_type_from_string() {
        let json = r#""png""#;
        let ft: FileType = serde_json::from_str(json).unwrap();
        assert!(matches!(ft, FileType::Png));
    }

    #[test]
    fn test_deserialize_file_type_from_unknown_string() {
        let json = r#""unknown_ext""#;
        let ft: FileType = serde_json::from_str(json).unwrap();
        match ft {
            FileType::Custom(s) => assert_eq!(s, "unknown_ext"),
            other => panic!("Expected Custom, got {:?}", other),
        }
    }

    #[test]
    fn test_deserialize_file_type_from_object() {
        let json = r#"{"custom": "application/octet-stream"}"#;
        let ft: FileType = serde_json::from_str(json).unwrap();
        match ft {
            FileType::Custom(s) => assert_eq!(s, "application/octet-stream"),
            other => panic!("Expected Custom, got {:?}", other),
        }
    }

    // --- FileUploadRequest deserialization ---

    #[test]
    fn test_deserialize_file_upload_request() {
        let json = r#"{
            "files": [
                {
                    "fileName": "model.pt",
                    "logName": "checkpoints/epoch_1",
                    "fileSize": 1024,
                    "fileType": "pt",
                    "step": 100,
                    "time": 1704067200
                }
            ]
        }"#;
        let req: FileUploadRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.files.len(), 1);
        assert_eq!(req.files[0].file_name, "model.pt");
        assert_eq!(req.files[0].log_name, "checkpoints/epoch_1");
        assert_eq!(req.files[0].file_size, 1024);
        assert_eq!(req.files[0].step, 100);
        assert!(matches!(req.files[0].file_type, FileType::Pt));
    }

    #[test]
    fn test_deserialize_file_upload_request_multiple_files() {
        let json = r#"{
            "files": [
                {"fileName": "a.png", "logName": "images", "fileSize": 100, "fileType": "png", "step": 1, "time": 1000},
                {"fileName": "b.csv", "logName": "data", "fileSize": 200, "fileType": "csv", "step": 2, "time": 2000}
            ]
        }"#;
        let req: FileUploadRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.files.len(), 2);
        assert!(matches!(req.files[0].file_type, FileType::Png));
        assert!(matches!(req.files[1].file_type, FileType::Csv));
    }

    #[test]
    fn test_deserialize_file_upload_request_custom_type() {
        let json = r#"{
            "files": [
                {"fileName": "data.bin", "logName": "artifacts", "fileSize": 500, "fileType": {"custom": "application/x-binary"}, "step": 1, "time": 1000}
            ]
        }"#;
        let req: FileUploadRequest = serde_json::from_str(json).unwrap();
        match &req.files[0].file_type {
            FileType::Custom(s) => assert_eq!(s, "application/x-binary"),
            other => panic!("Expected Custom, got {:?}", other),
        }
    }

    // --- PresignedUrlResponse serialization ---

    #[test]
    fn test_presigned_url_response_serialization() {
        let mut log_files = HashMap::new();
        log_files.insert(
            "val/epoch".to_string(),
            vec![HashMap::from([(
                "file.txt".to_string(),
                "https://example.com/url".to_string(),
            )])],
        );
        let resp = PresignedUrlResponse { log_files };
        let json = serde_json::to_string(&resp).unwrap();
        assert!(json.contains("val/epoch"));
        assert!(json.contains("file.txt"));
        assert!(json.contains("https://example.com/url"));
    }
}
