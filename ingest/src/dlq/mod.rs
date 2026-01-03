//! Dead-Letter Queue (DLQ) module for persisting failed batches to disk
//!
//! This module provides functionality to:
//! - Persist failed batches to disk as JSON files
//! - Replay persisted batches when ClickHouse recovers
//! - Clean up old batches based on TTL and disk quota
//!
//! The DLQ ensures zero data loss by preventing record drops when ClickHouse is unavailable.

pub mod cleanup;
pub mod replay;
pub mod storage;
pub mod types;

use std::path::PathBuf;
use tokio::fs;
use tracing::info;

/// All ClickHouse table names that support DLQ
pub const DLQ_TABLE_NAMES: &[&str] = &[
    crate::config::METRICS_TABLE_NAME,
    crate::config::LOGS_TABLE_NAME,
    crate::config::DATA_TABLE_NAME,
    crate::config::FILES_TABLE_NAME,
];

/// Configuration for the Dead-Letter Queue
#[derive(Debug, Clone)]
pub struct DlqConfig {
    /// Whether DLQ is enabled
    pub enabled: bool,
    /// Base path for DLQ storage
    pub base_path: PathBuf,
    /// Maximum disk usage in MB
    pub max_disk_mb: u64,
    /// Batch TTL in hours
    pub batch_ttl_hours: u64,
    /// Whether to replay batches on startup
    pub replay_on_startup: bool,
    /// Replay interval in seconds (for background replay)
    pub replay_interval_secs: u64,
    /// Cleanup interval in seconds (for expired batch cleanup and quota enforcement)
    pub cleanup_interval_secs: u64,
}

impl DlqConfig {
    /// Loads DLQ configuration from environment variables
    pub fn from_env() -> Self {
        Self {
            enabled: std::env::var("DLQ_ENABLED")
                .unwrap_or_else(|_| "true".to_string())
                .parse()
                .unwrap_or(true),
            base_path: PathBuf::from(
                std::env::var("DLQ_PATH").unwrap_or_else(|_| "/var/mlop/dlq".to_string()),
            ),
            max_disk_mb: std::env::var("DLQ_MAX_DISK_MB")
                .unwrap_or_else(|_| "10240".to_string())
                .parse()
                .unwrap_or(10240),
            batch_ttl_hours: std::env::var("DLQ_TTL_HOURS")
                .unwrap_or_else(|_| "168".to_string())
                .parse()
                .unwrap_or(168),
            replay_on_startup: std::env::var("DLQ_REPLAY_ON_STARTUP")
                .unwrap_or_else(|_| "true".to_string())
                .parse()
                .unwrap_or(true),
            replay_interval_secs: std::env::var("DLQ_REPLAY_INTERVAL_SECS")
                .unwrap_or_else(|_| "60".to_string())
                .parse()
                .unwrap_or(60),
            cleanup_interval_secs: std::env::var("DLQ_CLEANUP_INTERVAL_SECS")
                .unwrap_or_else(|_| "3600".to_string())
                .parse()
                .unwrap_or(3600),
        }
    }

    #[cfg(test)]
    pub fn for_testing(base_path: PathBuf) -> Self {
        Self {
            enabled: true,
            base_path,
            max_disk_mb: 1024,
            batch_ttl_hours: 24,
            replay_on_startup: false,
            replay_interval_secs: 10,
            cleanup_interval_secs: 60,
        }
    }
}

/// Initializes DLQ directories for all table types
pub async fn init_directories(config: &DlqConfig) -> Result<(), std::io::Error> {
    if !config.enabled {
        info!("DLQ is disabled");
        return Ok(());
    }

    // Create base directory
    fs::create_dir_all(&config.base_path).await?;

    // Create subdirectories for each table type
    for table in DLQ_TABLE_NAMES {
        let table_dir = config.base_path.join(table);
        fs::create_dir_all(&table_dir).await?;
    }

    // Create metadata directory
    let metadata_dir = config.base_path.join(".metadata");
    fs::create_dir_all(&metadata_dir).await?;

    info!(
        path = %config.base_path.display(),
        "DLQ directories initialized"
    );

    Ok(())
}

/// Persists a batch to the DLQ
///
/// This is the main entry point for persisting failed batches.
pub async fn persist_batch<T>(
    records: &[T],
    table_name: String,
    config: &DlqConfig,
) -> Result<(), storage::DlqError>
where
    T: serde::Serialize + Clone,
{
    if !config.enabled {
        return Err(storage::DlqError::Disabled);
    }

    // Check disk quota before persisting
    storage::check_disk_quota(&config.base_path, config.max_disk_mb, records.len()).await?;

    // Persist the batch
    storage::persist_batch(records, table_name, &config.base_path).await?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;
    use tempfile::TempDir;

    // Mutex to ensure DLQ env var tests don't run in parallel
    static ENV_MUTEX: Mutex<()> = Mutex::new(());

    #[test]
    fn test_dlq_config_from_env() {
        let _guard = ENV_MUTEX.lock().unwrap();

        // Set environment variables
        std::env::set_var("DLQ_ENABLED", "true");
        std::env::set_var("DLQ_PATH", "/tmp/test-dlq");
        std::env::set_var("DLQ_MAX_DISK_MB", "5120");
        std::env::set_var("DLQ_TTL_HOURS", "72");
        std::env::set_var("DLQ_REPLAY_ON_STARTUP", "false");
        std::env::set_var("DLQ_REPLAY_INTERVAL_SECS", "30");

        let config = DlqConfig::from_env();

        // Clean up BEFORE assertions so other tests can run
        std::env::remove_var("DLQ_ENABLED");
        std::env::remove_var("DLQ_PATH");
        std::env::remove_var("DLQ_MAX_DISK_MB");
        std::env::remove_var("DLQ_TTL_HOURS");
        std::env::remove_var("DLQ_REPLAY_ON_STARTUP");
        std::env::remove_var("DLQ_REPLAY_INTERVAL_SECS");

        assert!(config.enabled);
        assert_eq!(config.base_path, PathBuf::from("/tmp/test-dlq"));
        assert_eq!(config.max_disk_mb, 5120);
        assert_eq!(config.batch_ttl_hours, 72);
        assert!(!config.replay_on_startup);
        assert_eq!(config.replay_interval_secs, 30);
    }

    #[test]
    fn test_dlq_config_defaults() {
        let _guard = ENV_MUTEX.lock().unwrap();

        // Ensure env vars are not set
        std::env::remove_var("DLQ_ENABLED");
        std::env::remove_var("DLQ_PATH");
        std::env::remove_var("DLQ_MAX_DISK_MB");
        std::env::remove_var("DLQ_TTL_HOURS");
        std::env::remove_var("DLQ_REPLAY_ON_STARTUP");
        std::env::remove_var("DLQ_REPLAY_INTERVAL_SECS");

        let config = DlqConfig::from_env();

        assert!(config.enabled);
        assert_eq!(config.base_path, PathBuf::from("/var/mlop/dlq"));
        assert_eq!(config.max_disk_mb, 10240);
        assert_eq!(config.batch_ttl_hours, 168);
        assert!(config.replay_on_startup);
        assert_eq!(config.replay_interval_secs, 60);
    }

    #[tokio::test]
    async fn test_init_directories() {
        let temp_dir = TempDir::new().unwrap();
        let config = DlqConfig::for_testing(temp_dir.path().to_path_buf());

        init_directories(&config).await.unwrap();

        // Verify all directories were created
        assert!(temp_dir.path().join("mlop_metrics").exists());
        assert!(temp_dir.path().join("mlop_logs").exists());
        assert!(temp_dir.path().join("mlop_data").exists());
        assert!(temp_dir.path().join("mlop_files").exists());
        assert!(temp_dir.path().join(".metadata").exists());
    }

    #[tokio::test]
    async fn test_persist_batch_integration() {
        let temp_dir = TempDir::new().unwrap();
        let config = DlqConfig::for_testing(temp_dir.path().to_path_buf());

        init_directories(&config).await.unwrap();

        let records = vec![1, 2, 3, 4, 5];
        let result = persist_batch(&records, "mlop_metrics".to_string(), &config).await;

        assert!(result.is_ok());

        // Verify file was created
        let batches = storage::list_batches(&config.base_path, "mlop_metrics")
            .await
            .unwrap();
        assert_eq!(batches.len(), 1);
    }

    #[tokio::test]
    async fn test_persist_batch_disabled() {
        let temp_dir = TempDir::new().unwrap();
        let mut config = DlqConfig::for_testing(temp_dir.path().to_path_buf());
        config.enabled = false;

        let records = vec![1, 2, 3];
        let result = persist_batch(&records, "mlop_metrics".to_string(), &config).await;

        assert!(matches!(result, Err(storage::DlqError::Disabled)));
    }
}
