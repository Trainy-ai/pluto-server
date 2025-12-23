use clickhouse::Client;
use std::collections::VecDeque;
use std::sync::Arc;
use std::time::Instant;
use tokio::select;
use tokio::sync::mpsc;
use tokio::time::{sleep, Duration};
use tracing::{debug, error, info, instrument, warn, Instrument};

use crate::config::{Config, FlushConfig};
use crate::traits::{DatabaseRow, EnrichmentData, InputData};

// Starts a generic background processor task
// This task receives records of type `F` through an MPSC channel,
// buffers them, and periodically flushes them to a ClickHouse table
pub async fn start_background_processor<F, R, E>(
    mut receiver: mpsc::Receiver<F>, // The channel receiver for incoming records
    flush_config: FlushConfig,       // Configuration for batch size and flush interval
    skip_upload: bool,               // Flag to skip actual database uploads (for testing)
    config: Arc<Config>,             // Shared application configuration (for DB credentials etc)
) where
    F: DatabaseRow<R, E> + Send + 'static, // `F` must be a DatabaseRow, Send, and static lifetime
    R: InputData,
    E: EnrichmentData,
{
    // Initialize ClickHouse client
    let client = Client::default()
        .with_url(config.clickhouse_url.clone())
        .with_user(config.clickhouse_user.clone())
        .with_password(config.clickhouse_password.clone());

    // Get the target table name from the DatabaseRow trait implementation
    let table_name = F::table_name().to_string();
    // Create a tracing span for this specific processor instance
    let processor_span = tracing::info_span!("background_processor", table = %table_name);

    // Enter the instrumented async block
    async move {
        // Buffer to hold records before flushing
        let mut buffer = VecDeque::with_capacity(flush_config.batch_size);
        // Track the time of the last successful flush
        let mut last_flush = Instant::now();
        // Count consecutive errors during flushing
        let mut consecutive_errors = 0;

        // Spawn a simple timer task to trigger inactivity checks periodically
        let (inactivity_tx, mut inactivity_rx) = mpsc::channel::<()>(1);
        let inactivity_tx_clone = inactivity_tx.clone();

        tokio::spawn(async move {
            loop {
                sleep(Duration::from_secs(1)).await; // Check every second
                if inactivity_tx_clone.send(()).await.is_err() {
                    // Stop if the main processor loop has ended
                    break;
                }
            }
        });

        // info!(batch_size = flush_config.batch_size, flush_interval = ?flush_config.flush_interval, "Background processor started");

        // Main processing loop
        loop {
            // Pre-check: If buffer is completely full, force a flush immediately
            // This prevents the select! from potentially adding another record and exceeding capacity
            if buffer.len() >= flush_config.batch_size {
                debug!(
                    buffer_len = buffer.len(),
                    batch_size = flush_config.batch_size,
                    "Buffer full, forced flush"
                );
                if !skip_upload {
                    flush_records(
                        &client,
                        &mut buffer,
                        &mut consecutive_errors,
                        &mut last_flush,
                        table_name.clone(),
                    )
                    .await;
                }
            }

            // Wait for either a new record or an inactivity tick
            select! {
                // Branch 1: A new record is received from the channel
                record = receiver.recv() => {
                    match record {
                        Some(record) => {
                            // Add the record to the buffer
                            buffer.push_back(record);
                            let buffer_len = buffer.len();
                            debug!(buffer_len, "Record added to buffer");
                        }
                        // Branch 1.1: The input channel was closed
                        None => {
                            info!("Input channel closed. Performing final flush.");
                            // If there are remaining records in the buffer, perform a final flush
                            if !buffer.is_empty() && !skip_upload {
                                final_flush(&client, &mut buffer, table_name.clone()).await;
                            }
                            info!("Exiting background processor.");
                            break; // Exit the loop
                        }
                    }
                }
                // Branch 2: The inactivity timer ticked
                _ = inactivity_rx.recv() => {
                    let buffer_len = buffer.len();
                    // Check if the flush interval has passed since the last record was received
                    // and if the buffer is not empty
                    if last_flush.elapsed() >= flush_config.flush_interval && buffer_len > 0 && !skip_upload {
                        debug!(buffer_len, elapsed_since_last_flush_ms = last_flush.elapsed().as_millis(), "Flushing due to interval"); 
                        // Flush the buffer due to inactivity
                        flush_records(
                            &client,
                            &mut buffer,
                            &mut consecutive_errors,
                            &mut last_flush,
                            table_name.clone(),
                        ).await;
                    }
                }
            }
        }
    }
    .instrument(processor_span)
    .await // Apply the tracing span to the entire async block
}

// Function to flush a batch of records to ClickHouse with retry logic
#[instrument(skip(client, buffer, consecutive_errors, last_flush, table_name), fields(batch_size = buffer.len()))]
async fn flush_records<F, R, E>(
    client: &Client,              // ClickHouse client instance
    buffer: &mut VecDeque<F>,     // Buffer containing records to flush
    consecutive_errors: &mut u32, // Mutable counter for consecutive errors
    last_flush: &mut Instant,     // Mutable timestamp of the last successful flush
    table_name: String,           // Name of the target ClickHouse table
) where
    F: DatabaseRow<R, E> + Send + 'static + std::fmt::Debug + Clone, // Added Clone requirement
    R: InputData,
    E: EnrichmentData,
{
    if buffer.is_empty() {
        debug!("Flush called on empty buffer, skipping.");
        return;
    }
    // Drain the buffer into a Vec for processing
    let records_to_flush: Vec<_> = buffer.drain(..).collect();
    let num_records = records_to_flush.len();
    // Update the span with the actual number of records being flushed
    tracing::Span::current().record("batch_size", &num_records);

    let max_retries = 3; // Maximum number of retries for flushing
    let mut retry_count = 0;

    // info!(num_records, "Attempting to flush batch");

    // Retry loop
    loop {
        let client = client.clone();
        // Conditionally enable async insert based on batch size (heuristic)
        let client = if num_records > 1000 {
            client // Use synchronous insert for very large batches
        } else {
            // Use async insert for smaller batches
            client
                .with_option("async_insert", "1")
                .with_option("wait_for_async_insert", "0")
        };

        let start = Instant::now();
        let table_name_clone = table_name.clone();
        // Clone client and table_name for the inner async block
        let current_client = client.clone();
        let current_table_name = table_name_clone.clone();
        // Execute the insertion in a separate async block for better tracing
        let result = async {
            // Outer block is not move
            let insert_span = tracing::debug_span!("clickhouse_insert", count = num_records);
            // Inner block is not move, captures what it needs
            async {
                let mut insert = current_client.insert(&current_table_name)?;
                // Write each record by reference from the original Vec
                for record in &records_to_flush {
                    // Borrow records_to_flush
                    insert.write(record).await?;
                }
                // Finalize the insert operation
                insert.end().await?;
                Ok::<_, clickhouse::error::Error>(())
            }
            .instrument(insert_span)
            .await
        }
        .await;

        match result {
            Ok(_) => {
                // Success!
                let elapsed_ms = start.elapsed().as_millis();
                info!(
                    elapsed_ms,
                    attempt = retry_count + 1,
                    "Successfully uploaded batch"
                );
                // Reset consecutive error count and update last flush time
                *consecutive_errors = 0;
                *last_flush = Instant::now();
                return; // Exit the flush function
            }
            Err(e) => {
                // Failure
                retry_count += 1;
                let error_message = format!("{}", e);
                warn!(attempt = retry_count, max_attempts = max_retries, error = %error_message, "Error uploading batch");

                // Check if max retries reached
                if retry_count >= max_retries {
                    error!(
                        attempts = max_retries,
                        "Failed to upload batch after multiple attempts. Dropping batch."
                    );
                    // Increment consecutive errors, update last flush (attempt) time, and return
                    *consecutive_errors += 1;
                    *last_flush = Instant::now();
                    // Note: The records are dropped here as `records_to_flush` goes out of scope
                    return;
                }

                // Calculate exponential backoff duration
                let backoff_duration = Duration::from_secs(2u64.pow(retry_count));
                warn!(duration = ?backoff_duration, "Backing off before retry.");
                // Wait before the next retry
                sleep(backoff_duration).await;
            }
        }
    }
}

// Function to perform a final flush attempt when the processor is shutting down
// This uses a higher retry count and panics if flushing ultimately fails
#[instrument(skip(client, buffer), fields(table = %table_name, batch_size = buffer.len()))]
async fn final_flush<F, R, E>(client: &Client, buffer: &mut VecDeque<F>, table_name: String)
where
    F: DatabaseRow<R, E> + Send + 'static + Clone, // Added Clone requirement
    R: InputData,
    E: EnrichmentData,
{
    // Drain the buffer
    let records_to_flush: Vec<_> = buffer.drain(..).collect();
    let num_records = records_to_flush.len();
    // Update span field
    tracing::Span::current().record("batch_size", &num_records);

    if num_records == 0 {
        info!("Final flush called with empty buffer, skipping.");
        return;
    }

    let mut retry_count = 0;
    let max_retries = 5; // Higher retry limit for final flush

    info!(num_records, "Starting final flush");

    // Retry loop (similar to flush_records, but panics on persistent failure)
    loop {
        let table_name_clone = table_name.clone();
        // Clone client and table_name for the inner async block
        let current_client = client.clone();
        let current_table_name = table_name_clone.clone();
        match async {
            // Outer block is not move
            let insert_span = tracing::debug_span!("clickhouse_final_insert", count = num_records);
            // Inner block is not move, captures what it needs
            async {
                let mut insert = current_client.insert(&current_table_name)?;
                // Write records by reference from the original Vec
                for record in &records_to_flush {
                    // Borrow records_to_flush
                    insert.write(record).await?;
                }
                insert.end().await?;
                Ok::<_, clickhouse::error::Error>(())
            }
            .instrument(insert_span)
            .await
        }
        .await
        {
            Ok(_) => {
                // Success!
                info!(num_records, "Successfully completed final flush");
                break; // Exit the loop and function
            }
            Err(e) => {
                // Failure
                retry_count += 1;
                let error_message = format!("{}", e);
                error!(attempt = retry_count, max_attempts = max_retries, error = %error_message, "Error in final flush");
                // Check if max retries reached
                if retry_count >= max_retries {
                    // Panic if the final flush fails after all retries
                    // This is considered a critical failure as data would be lost
                    panic!(
                        "Failed to flush final batch of {} records to table '{}' after {} attempts. Error: {}",
                        num_records, table_name, max_retries, error_message
                    );
                }
                // Calculate backoff and wait
                let backoff_duration = Duration::from_secs(2u64.pow(retry_count));
                warn!(duration = ?backoff_duration, "Backing off before final flush retry.");
                sleep(backoff_duration).await;
            }
        }
    }
}
