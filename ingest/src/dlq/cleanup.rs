use crate::dlq::storage::{self, DlqError};
use crate::dlq::types::CleanupStats;
use crate::dlq::DlqConfig;
use chrono::{DateTime, Duration, NaiveDateTime, Utc};
use std::path::PathBuf;
use tokio::fs;
use tracing::{info, warn};

/// Deletes batches older than the configured TTL
pub async fn cleanup_expired_batches(config: &DlqConfig) -> Result<CleanupStats, DlqError> {
    if !config.enabled {
        return Ok(CleanupStats::default());
    }

    let cutoff = Utc::now() - Duration::hours(config.batch_ttl_hours as i64);
    let mut stats = CleanupStats { deleted: 0 };

    for table_name in super::DLQ_TABLE_NAMES {
        let batches = storage::list_batches(&config.base_path, table_name).await?;

        for batch_path in batches {
            if let Ok(should_delete) = is_batch_expired(&batch_path, cutoff).await {
                if should_delete {
                    match storage::delete_batch(&batch_path).await {
                        Ok(_) => {
                            stats.deleted += 1;
                            info!(
                                path = %batch_path.display(),
                                "Deleted expired batch"
                            );
                        }
                        Err(e) => {
                            warn!(
                                path = %batch_path.display(),
                                error = %e,
                                "Failed to delete expired batch"
                            );
                        }
                    }
                }
            }
        }
    }

    if stats.deleted > 0 {
        info!(deleted = stats.deleted, "Cleanup completed");
    }

    Ok(stats)
}

/// Enforces disk quota by deleting oldest batches first
pub async fn enforce_disk_quota(config: &DlqConfig) -> Result<(), DlqError> {
    if !config.enabled {
        return Ok(());
    }

    let mut total_size = storage::calculate_disk_usage(&config.base_path).await?;
    let max_bytes = config.max_disk_mb * 1024 * 1024;

    if total_size <= max_bytes {
        return Ok(());
    }

    warn!(
        current_mb = total_size / 1024 / 1024,
        max_mb = config.max_disk_mb,
        "DLQ disk quota exceeded, deleting oldest batches"
    );

    // Collect all batches with their sizes
    let mut all_batches = Vec::new();
    for table_name in super::DLQ_TABLE_NAMES {
        let batches = storage::list_batches(&config.base_path, table_name).await?;
        for batch_path in batches {
            match fs::metadata(&batch_path).await {
                Ok(metadata) => {
                    all_batches.push((batch_path, metadata.len()));
                }
                Err(e) => {
                    warn!(
                        path = %batch_path.display(),
                        error = %e,
                        "Failed to read batch metadata during quota enforcement"
                    );
                }
            }
        }
    }

    // Sort by name (which includes timestamp, so oldest first)
    all_batches.sort_by(|a, b| a.0.cmp(&b.0));

    // Delete oldest batches until we're under quota
    let mut deleted = 0;
    for (batch_path, size) in all_batches {
        if total_size <= max_bytes {
            break;
        }

        match storage::delete_batch(&batch_path).await {
            Ok(_) => {
                total_size = total_size.saturating_sub(size);
                deleted += 1;
                info!(
                    path = %batch_path.display(),
                    size_kb = size / 1024,
                    "Deleted batch to enforce quota"
                );
            }
            Err(e) => {
                warn!(
                    path = %batch_path.display(),
                    error = %e,
                    "Failed to delete batch for quota enforcement"
                );
            }
        }
    }

    info!(
        deleted,
        current_mb = total_size / 1024 / 1024,
        "Disk quota enforcement completed"
    );

    Ok(())
}

/// Checks if a batch is older than the cutoff time by parsing the filename timestamp
async fn is_batch_expired(path: &PathBuf, cutoff: DateTime<Utc>) -> Result<bool, DlqError> {
    // Extract filename: "2024-07-25T12-34-56.123_<uuid>.json"
    let filename = path
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| {
            DlqError::Io(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "Invalid batch filename",
            ))
        })?;

    // Parse timestamp part (before underscore)
    let timestamp_str = filename.split('_').next().ok_or_else(|| {
        DlqError::Io(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "Filename missing timestamp",
        ))
    })?;

    // Parse: "2024-07-25T12-34-56.123"
    // Format uses hyphens in time portion, need to parse carefully
    let parts: Vec<&str> = timestamp_str.split('T').collect();
    if parts.len() != 2 {
        return Err(DlqError::Io(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "Invalid timestamp format",
        )));
    }

    let date_part = parts[0];
    let time_part = parts[1].replace('-', ":");
    let iso_format = format!("{}T{}", date_part, time_part);

    let naive_dt = NaiveDateTime::parse_from_str(&iso_format, "%Y-%m-%dT%H:%M:%S%.3f")
        .map_err(|e| {
            DlqError::Io(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                format!("Failed to parse timestamp: {}", e),
            ))
        })?;

    let batch_time = DateTime::<Utc>::from_naive_utc_and_offset(naive_dt, Utc);

    Ok(batch_time < cutoff)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[tokio::test]
    async fn test_cleanup_expired_batches_empty() {
        let temp_dir = TempDir::new().unwrap();
        let config = DlqConfig::for_testing(temp_dir.path().to_path_buf());

        crate::dlq::init_directories(&config).await.unwrap();

        let stats = cleanup_expired_batches(&config).await.unwrap();
        assert_eq!(stats.deleted, 0);
    }

    #[tokio::test]
    async fn test_cleanup_disabled() {
        let temp_dir = TempDir::new().unwrap();
        let mut config = DlqConfig::for_testing(temp_dir.path().to_path_buf());
        config.enabled = false;

        let stats = cleanup_expired_batches(&config).await.unwrap();
        assert_eq!(stats.deleted, 0);
    }

    #[tokio::test]
    async fn test_enforce_disk_quota_under_limit() {
        let temp_dir = TempDir::new().unwrap();
        let config = DlqConfig::for_testing(temp_dir.path().to_path_buf());

        crate::dlq::init_directories(&config).await.unwrap();

        // Should not error when under quota
        enforce_disk_quota(&config).await.unwrap();
    }

    #[tokio::test]
    async fn test_enforce_disk_quota_disabled() {
        let temp_dir = TempDir::new().unwrap();
        let mut config = DlqConfig::for_testing(temp_dir.path().to_path_buf());
        config.enabled = false;

        // Should not error when disabled
        enforce_disk_quota(&config).await.unwrap();
    }
}
