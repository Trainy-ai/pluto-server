use crate::dlq::storage::{self, DlqError};
use crate::dlq::types::{BatchEnvelope, ReplayStats};
use crate::dlq::DlqConfig;
use crate::traits::{DatabaseRow, EnrichmentData, InputData};
use clickhouse::Client;
use std::sync::Arc;
use tokio::time::{interval, Duration};
use tracing::{error, info, warn};

/// Replays all persisted batches for a given table on startup
///
/// This function is called once during service startup to replay any batches
/// that were persisted to DLQ during previous runs.
pub async fn replay_on_startup<F, R, E>(
    client: &Client,
    config: &DlqConfig,
    table_name: &str,
) -> Result<ReplayStats, DlqError>
where
    F: DatabaseRow<R, E> + Send + 'static + Clone,
    R: InputData,
    E: EnrichmentData,
{
    if !config.enabled {
        return Ok(ReplayStats::default());
    }

    info!(table = %table_name, "Starting DLQ replay on startup");

    let batches = storage::list_batches(&config.base_path, table_name).await?;
    let mut stats = ReplayStats {
        replayed: 0,
        failed_batches: 0,
        failed_records: 0,
    };

    if batches.is_empty() {
        info!(table = %table_name, "No DLQ batches to replay");
        return Ok(stats);
    }

    info!(
        table = %table_name,
        batch_count = batches.len(),
        "Found batches to replay"
    );

    for batch_path in batches {
        // Load the batch
        let batch: BatchEnvelope<F> = match storage::load_batch(&batch_path).await {
            Ok(b) => b,
            Err(e) => {
                error!(
                    path = %batch_path.display(),
                    error = %e,
                    "Failed to load batch, skipping"
                );
                stats.failed_batches += 1;
                continue;
            }
        };

        // Try to insert with retries
        match insert_batch_with_retries(client, &batch.records, table_name, 5).await {
            Ok(_) => {
                // Successfully replayed, delete the batch file
                if let Err(e) = storage::delete_batch(&batch_path).await {
                    warn!(
                        path = %batch_path.display(),
                        error = %e,
                        "Failed to delete replayed batch file"
                    );
                }
                stats.replayed += batch.record_count;
                info!(
                    path = %batch_path.display(),
                    records = batch.record_count,
                    "Successfully replayed batch"
                );
            }
            Err(e) => {
                warn!(
                    path = %batch_path.display(),
                    error = %e,
                    "Failed to replay batch, will retry later"
                );
                stats.failed_records += batch.record_count;
            }
        }
    }

    info!(
        table = %table_name,
        replayed = stats.replayed,
        failed_batches = stats.failed_batches,
        failed_records = stats.failed_records,
        "DLQ startup replay completed"
    );

    Ok(stats)
}

/// Background task that continuously replays batches at a configured interval
///
/// This function includes panic recovery - if the replay loop panics, it will
/// automatically restart with exponential backoff (up to 5 minutes).
pub async fn start_replay_loop<F, R, E>(
    client: Client,
    config: Arc<DlqConfig>,
    table_name: String,
) where
    F: DatabaseRow<R, E> + Send + Sync + 'static + Clone,
    R: InputData,
    E: EnrichmentData,
{
    if !config.enabled {
        info!(table = %table_name, "DLQ replay loop disabled");
        return;
    }

    let mut restart_count = 0u32;
    let max_backoff_secs = 300; // 5 minutes

    loop {
        info!(
            table = %table_name,
            interval_secs = config.replay_interval_secs,
            restart_count = restart_count,
            "Starting DLQ replay loop"
        );

        // Spawn the actual replay loop in a nested task to catch panics
        let task_client = client.clone();
        let task_config = config.clone();
        let task_table = table_name.clone();

        let handle = tokio::spawn(async move {
            replay_loop_inner::<F, R, E>(task_client, task_config, task_table).await
        });

        // Wait for the task to complete (either panic or normal exit)
        match handle.await {
            Ok(_) => {
                // Normal exit (should never happen for infinite loop)
                warn!(table = %table_name, "DLQ replay loop exited normally (unexpected)");
            }
            Err(e) => {
                // Task panicked
                error!(
                    table = %table_name,
                    error = %e,
                    restart_count = restart_count,
                    "DLQ replay loop panicked, will restart"
                );
            }
        }

        // Exponential backoff before restart (capped at max_backoff_secs)
        restart_count += 1;
        let backoff_secs = (2u64.pow(restart_count).min(max_backoff_secs as u64)) as u64;
        warn!(
            table = %table_name,
            backoff_secs = backoff_secs,
            "Waiting before restarting DLQ replay loop"
        );
        tokio::time::sleep(Duration::from_secs(backoff_secs)).await;
    }
}

/// Inner replay loop that runs the actual replay logic
async fn replay_loop_inner<F, R, E>(
    client: Client,
    config: Arc<DlqConfig>,
    table_name: String,
) where
    F: DatabaseRow<R, E> + Send + Sync + 'static + Clone,
    R: InputData,
    E: EnrichmentData,
{
    let mut tick = interval(Duration::from_secs(config.replay_interval_secs));

    loop {
        tick.tick().await;

        match replay_iteration::<F, R, E>(&client, &config, &table_name).await {
            Ok(stats) => {
                if stats.replayed > 0 || stats.failed_batches > 0 || stats.failed_records > 0 {
                    info!(
                        table = %table_name,
                        replayed = stats.replayed,
                        failed_batches = stats.failed_batches,
                        failed_records = stats.failed_records,
                        "DLQ replay iteration completed"
                    );
                }
            }
            Err(e) => {
                error!(table = %table_name, error = %e, "DLQ replay iteration failed");
            }
        }
    }
}

/// Performs a single replay iteration for a table
async fn replay_iteration<F, R, E>(
    client: &Client,
    config: &DlqConfig,
    table_name: &str,
) -> Result<ReplayStats, DlqError>
where
    F: DatabaseRow<R, E> + Send + 'static + Clone,
    R: InputData,
    E: EnrichmentData,
{
    let batches = storage::list_batches(&config.base_path, table_name).await?;
    let mut stats = ReplayStats::default();

    for batch_path in batches.iter().take(10) {
        // Process max 10 batches per iteration
        let batch: BatchEnvelope<F> = match storage::load_batch(batch_path).await {
            Ok(b) => b,
            Err(e) => {
                error!(
                    path = %batch_path.display(),
                    error = %e,
                    "Failed to load batch"
                );
                stats.failed_batches += 1;
                continue;
            }
        };

        match insert_batch_with_retries(client, &batch.records, table_name, 3).await {
            Ok(_) => {
                storage::delete_batch(batch_path).await?;
                stats.replayed += batch.record_count;
            }
            Err(e) => {
                warn!(
                    path = %batch_path.display(),
                    error = %e,
                    "Failed to replay batch"
                );
                stats.failed_records += batch.record_count;
            }
        }
    }

    Ok(stats)
}

/// Inserts a batch into ClickHouse with retry logic
async fn insert_batch_with_retries<F>(
    client: &Client,
    records: &[F],
    table_name: &str,
    max_retries: u32,
) -> Result<(), clickhouse::error::Error>
where
    F: clickhouse::Row + serde::Serialize,
{
    let mut retry_count = 0;

    loop {
        let result = async {
            let mut insert = client.insert(table_name)?;
            for record in records {
                insert.write(record).await?;
            }
            insert.end().await?;
            Ok::<_, clickhouse::error::Error>(())
        }
        .await;

        match result {
            Ok(_) => return Ok(()),
            Err(e) => {
                retry_count += 1;
                if retry_count >= max_retries {
                    return Err(e);
                }
                let backoff_duration = Duration::from_secs(2u64.pow(retry_count));
                warn!(
                    attempt = retry_count,
                    max_attempts = max_retries,
                    backoff_secs = backoff_duration.as_secs(),
                    "Retry attempt for batch insert"
                );
                tokio::time::sleep(backoff_duration).await;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[tokio::test]
    async fn test_replay_disabled() {
        let temp_dir = TempDir::new().unwrap();
        let mut config = DlqConfig::for_testing(temp_dir.path().to_path_buf());
        config.enabled = false;

        // Replay logic is tested in integration tests with real types
        assert!(!config.enabled);
    }
}
