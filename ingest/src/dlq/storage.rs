use crate::dlq::types::BatchEnvelope;
use chrono::Utc;
use serde::Serialize;
use std::path::{Path, PathBuf};
use tokio::fs;
use tracing::{debug, info, warn};

/// Errors that can occur during DLQ operations
#[derive(Debug, thiserror::Error)]
pub enum DlqError {
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("Serialization error: {0}")]
    Serialization(#[from] serde_json::Error),

    #[error("Disk quota exceeded")]
    DiskQuotaExceeded,

    #[error("DLQ is disabled")]
    Disabled,
}

/// Persists a batch of records to disk as JSON
///
/// # Arguments
/// * `records` - The records to persist
/// * `table_name` - The ClickHouse table name
/// * `base_path` - Base directory for DLQ storage
///
/// # Returns
/// Path to the persisted batch file
pub async fn persist_batch<T>(
    records: &[T],
    table_name: String,
    base_path: &Path,
) -> Result<PathBuf, DlqError>
where
    T: Serialize + Clone,
{
    if records.is_empty() {
        debug!("Skipping persist of empty batch");
        return Err(DlqError::Io(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "Empty batch",
        )));
    }

    // Create table-specific directory
    let table_dir = base_path.join(&table_name);
    fs::create_dir_all(&table_dir).await?;

    // Generate unique filename with timestamp and UUID
    let timestamp = Utc::now();
    let batch_id = uuid::Uuid::new_v4();
    let filename = format!(
        "{}_{}.json",
        timestamp.format("%Y-%m-%dT%H-%M-%S%.3f"),
        batch_id
    );
    let file_path = table_dir.join(&filename);

    // Create batch envelope
    let envelope = BatchEnvelope {
        table_name: table_name.clone(),
        timestamp,
        record_count: records.len(),
        records: records.to_vec(),
    };

    // Serialize to JSON
    let json_data = serde_json::to_vec(&envelope)?;

    // Atomic write: write to temp file, then rename
    let temp_path = table_dir.join(format!("{}.tmp", filename));
    fs::write(&temp_path, &json_data).await?;
    fs::rename(&temp_path, &file_path).await?;

    info!(
        table = %table_name,
        records = records.len(),
        path = %file_path.display(),
        "Batch persisted to DLQ"
    );

    Ok(file_path)
}

/// Loads a batch from disk
pub async fn load_batch<T>(path: &Path) -> Result<BatchEnvelope<T>, DlqError>
where
    T: serde::de::DeserializeOwned,
{
    let json_data = fs::read(path).await?;
    let envelope = serde_json::from_slice(&json_data)?;
    Ok(envelope)
}

/// Deletes a batch file from disk
pub async fn delete_batch(path: &Path) -> Result<(), DlqError> {
    fs::remove_file(path).await?;
    debug!(path = %path.display(), "Batch deleted from DLQ");
    Ok(())
}

/// Lists all batch files for a given table, sorted by modification time (oldest first)
pub async fn list_batches(base_path: &Path, table_name: &str) -> Result<Vec<PathBuf>, DlqError> {
    let table_dir = base_path.join(table_name);

    // Return empty list if directory doesn't exist
    if !table_dir.exists() {
        return Ok(vec![]);
    }

    let mut batches = Vec::new();
    let mut entries = fs::read_dir(&table_dir).await?;

    while let Some(entry) = entries.next_entry().await? {
        let path = entry.path();
        if path.extension().and_then(|s| s.to_str()) == Some("json") {
            batches.push(path);
        }
    }

    // Sort by file name (which includes timestamp)
    batches.sort();

    Ok(batches)
}

/// Calculates total disk usage of DLQ in bytes
pub async fn calculate_disk_usage(base_path: &Path) -> Result<u64, DlqError> {
    let mut total_size = 0u64;

    if !base_path.exists() {
        return Ok(0);
    }

    let mut stack = vec![base_path.to_path_buf()];

    while let Some(dir) = stack.pop() {
        let mut entries = match fs::read_dir(&dir).await {
            Ok(e) => e,
            Err(_) => continue,
        };

        while let Some(entry) = entries.next_entry().await? {
            let path = entry.path();
            let metadata = match fs::metadata(&path).await {
                Ok(m) => m,
                Err(e) => {
                    warn!(
                        path = %path.display(),
                        error = %e,
                        "Failed to read file metadata during disk usage calculation"
                    );
                    continue;
                }
            };

            if metadata.is_dir() {
                stack.push(path);
            } else {
                total_size += metadata.len();
            }
        }
    }

    Ok(total_size)
}

/// Checks if disk quota would be exceeded by writing a batch
///
/// # Soft Limit Enforcement
///
/// This implements a **soft limit** with best-effort enforcement. There is an inherent
/// TOCTOU (Time-of-Check-Time-of-Use) race condition between checking quota and writing:
/// - Thread A checks quota → passes
/// - Thread B checks quota → passes
/// - Both threads write → quota exceeded
///
/// This is **acceptable** for the DLQ use case because:
/// 1. The DLQ is an emergency buffer during ClickHouse outages (rare occurrence)
/// 2. Conservative 1KB/record estimate provides built-in headroom
/// 3. Background cleanup enforces quota retroactively (see `dlq::cleanup::enforce_disk_quota`)
/// 4. Strict enforcement would require locks that could slow down critical failure paths
///
/// The quota acts as a safety net to prevent unbounded growth, not a hard invariant.
pub async fn check_disk_quota(
    base_path: &Path,
    max_disk_mb: u64,
    batch_size_estimate: usize,
) -> Result<(), DlqError> {
    let current_bytes = calculate_disk_usage(base_path).await?;
    let max_bytes = max_disk_mb * 1024 * 1024;

    // Pre-flight disk quota check using conservative estimate.
    // NOTE: We estimate ~1KB per record as a rough heuristic to avoid the overhead
    // of serializing the entire batch to measure actual size. This is intentionally
    // conservative and may overestimate, but prevents quota violations during persist.
    // Actual batch size is determined during serialization (line 72).
    let estimated_new_bytes = batch_size_estimate * 1024;

    if current_bytes + estimated_new_bytes as u64 > max_bytes {
        warn!(
            current_mb = current_bytes / 1024 / 1024,
            max_mb = max_disk_mb,
            "DLQ disk quota would be exceeded"
        );
        return Err(DlqError::DiskQuotaExceeded);
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[tokio::test]
    async fn test_persist_and_load_batch() {
        let temp_dir = TempDir::new().unwrap();
        let base_path = temp_dir.path();

        let records = vec![1, 2, 3, 4, 5];
        let table_name = "test_table".to_string();

        // Persist batch
        let path = persist_batch(&records, table_name.clone(), base_path)
            .await
            .unwrap();

        assert!(path.exists());

        // Load batch
        let loaded: BatchEnvelope<i32> = load_batch(&path).await.unwrap();

        assert_eq!(loaded.table_name, table_name);
        assert_eq!(loaded.record_count, 5);
        assert_eq!(loaded.records, records);
    }

    #[tokio::test]
    async fn test_delete_batch() {
        let temp_dir = TempDir::new().unwrap();
        let base_path = temp_dir.path();

        let records = vec!["a", "b", "c"];
        let path = persist_batch(&records, "test_table".to_string(), base_path)
            .await
            .unwrap();

        assert!(path.exists());

        delete_batch(&path).await.unwrap();

        assert!(!path.exists());
    }

    #[tokio::test]
    async fn test_list_batches() {
        let temp_dir = TempDir::new().unwrap();
        let base_path = temp_dir.path();
        let table_name = "test_table".to_string();

        // Create multiple batches
        for i in 0..3 {
            tokio::time::sleep(tokio::time::Duration::from_millis(10)).await;
            persist_batch(&vec![i], table_name.clone(), base_path)
                .await
                .unwrap();
        }

        let batches = list_batches(base_path, &table_name).await.unwrap();
        assert_eq!(batches.len(), 3);
    }

    #[tokio::test]
    async fn test_calculate_disk_usage() {
        let temp_dir = TempDir::new().unwrap();
        let base_path = temp_dir.path();

        // Initially empty
        let usage = calculate_disk_usage(base_path).await.unwrap();
        assert_eq!(usage, 0);

        // Persist a batch
        let records = vec![1, 2, 3, 4, 5];
        persist_batch(&records, "test_table".to_string(), base_path)
            .await
            .unwrap();

        // Should have non-zero usage
        let usage = calculate_disk_usage(base_path).await.unwrap();
        assert!(usage > 0);
    }

    #[tokio::test]
    async fn test_check_disk_quota_exceeded() {
        let temp_dir = TempDir::new().unwrap();
        let base_path = temp_dir.path();

        // Set very small quota (1 MB)
        let max_disk_mb = 1;

        // Try to check quota for very large batch (2000 records ~= 2MB)
        let result = check_disk_quota(base_path, max_disk_mb, 2000).await;

        assert!(matches!(result, Err(DlqError::DiskQuotaExceeded)));
    }

    #[tokio::test]
    async fn test_persist_empty_batch_fails() {
        let temp_dir = TempDir::new().unwrap();
        let base_path = temp_dir.path();

        let records: Vec<i32> = vec![];
        let result = persist_batch(&records, "test_table".to_string(), base_path).await;

        assert!(result.is_err());
    }
}
