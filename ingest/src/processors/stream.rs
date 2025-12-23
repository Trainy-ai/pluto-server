use axum::http::HeaderMap;
use bytes::Bytes;
use futures::StreamExt;
use simd_json;
use std::{
    sync::Arc,
    time::{Duration, Instant},
};
use tokio::sync::mpsc;
use tracing::{debug, error, info, info_span, trace, warn, Instrument};

use crate::{
    auth::auth,
    db::Database,
    error::{AppError, ErrorCode},
    traits::{DatabaseRow, EnrichmentData, InputData, StreamProcessor},
};

/// Trait for input data types that can be converted into one or more database rows,
/// incorporating enrichment data
pub trait IntoRows<E, D>
where
    E: EnrichmentData, // The type providing enrichment context (e.g., from headers)
    D: DatabaseRow<Self, E>, // The target database row type
    Self: InputData + Sized,
{
    /// Converts the input data (`self`) into a vector of database rows (`D`)
    /// using the provided enrichment data (`E`)
    fn into_rows(self, enrichment: E) -> Result<Vec<D>, AppError>;
}

/// Marker trait for input types that always convert to exactly one database row
/// This allows providing a default `IntoRows` implementation
pub trait SingleRowInput: InputData {}

/// Default `IntoRows` implementation for types marked with `SingleRowInput`
impl<T, E, D> IntoRows<E, D> for T
where
    T: SingleRowInput, // Input type must be SingleRowInput
    E: EnrichmentData,
    D: DatabaseRow<T, E>, // The DatabaseRow impl must be for this specific input type T
{
    fn into_rows(self, enrichment: E) -> Result<Vec<D>, AppError> {
        // Simply create a single DatabaseRow and wrap it in a Vec
        Ok(vec![D::from(self, enrichment)?])
    }
}

// Processor implementation for handling newline-delimited JSON streams
pub struct JsonLineProcessor<R, E, D>
where
    R: InputData + IntoRows<E, D>, // R: Raw input type parsed from JSON
    E: EnrichmentData,             // E: Enrichment data type (e.g., from headers)
    D: DatabaseRow<R, E>,          // D: Target database row type
{
    record_sender: mpsc::Sender<D>, // Channel sender to the background processor for type D
    _raw_type: std::marker::PhantomData<R>, // Phantom data to hold the type R
    _enrichment_type: std::marker::PhantomData<E>, // Phantom data to hold the type E
    db: Arc<Database>,              // Shared database connection (for auth)
}

impl<R, E, D> JsonLineProcessor<R, E, D>
where
    R: InputData + IntoRows<E, D>,
    E: EnrichmentData,
    D: DatabaseRow<R, E>,
{
    // Constructor for the JsonLineProcessor
    pub fn new(record_sender: mpsc::Sender<D>, db: Arc<Database>) -> Self {
        Self {
            record_sender,
            db,
            _raw_type: std::marker::PhantomData,
            _enrichment_type: std::marker::PhantomData,
        }
    }
}

// Implementation of the StreamProcessor trait for JsonLineProcessor
impl<R, E, D> StreamProcessor<R, E, D> for JsonLineProcessor<R, E, D>
where
    R: InputData + IntoRows<E, D> + Send + 'static + for<'de> serde::Deserialize<'de>,
    E: EnrichmentData + Send + 'static + Clone,
    D: DatabaseRow<R, E> + Send + 'static,
{
    // Processes an incoming request body stream containing newline-delimited JSON
    async fn process_stream(
        self,
        headers: HeaderMap,
        body: axum::body::Body,
    ) -> Result<String, AppError> {
        // Authenticate the request using headers
        let auth_details = auth(&headers, &self.db).await?;
        let tenant_id = auth_details.tenant_id;

        // Create a tracing span for this stream processing operation
        let span = info_span!("process_stream", tenant_id = %tenant_id);
        async move {
            info!("Starting stream processing");
            // Extract enrichment data from headers specific to this data type
            let enrichment = E::from_headers(tenant_id, &headers)?;

            // Convert the request body into an asynchronous stream of Bytes chunks
            let mut stream = body.into_data_stream();
            let mut total_processed: usize = 0;
            let start_time = Instant::now(); // Track overall processing time
            let mut line_buffer = Vec::new(); // Buffer to accumulate bytes and find newlines
            let mut line_counter: u64 = 0; // Counter for lines processed (for logging)

            // Read chunks from the stream
            while let Some(chunk_result) = stream.next().await {
                let chunk: Bytes = chunk_result.map_err(|e| {
                    error!(error = %e, "Failed to read stream chunk");
                    AppError::new(
                        ErrorCode::StreamProcessingError,
                        format!("Failed to read stream chunk: {}", e),
                    )
                })?;
                trace!(bytes = chunk.len(), "Read chunk from stream");

                // Append the chunk to the line buffer
                line_buffer.extend_from_slice(&chunk);

                // Process complete lines found in the buffer
                while let Some(pos) = line_buffer.iter().position(|&b| b == b'\n') {
                    line_counter += 1;
                    // Extract the line (including the newline character) and remove it from the buffer
                    let mut line_bytes_mut = line_buffer.drain(..=pos).collect::<Vec<u8>>();
                    // Trim whitespace and newline characters from the extracted line
                    let start = line_bytes_mut.iter().position(|&b| !matches!(b, b' ' | b'\t')).unwrap_or(0);
                    let end = line_bytes_mut.iter().rposition(|&b| !matches!(b, b'\r' | b'\n' | b' ' | b'\t')).map_or(0, |p| p + 1);
                    
                    // Check if the effective line is empty after trimming conceptually
                    if start >= end {
                        trace!(line = line_counter, "Skipping empty line");
                        continue;
                    }

                    // Use the trimmed slice view for processing, avoid extra allocation if possible
                    // This slice is mutable which simd_json needs
                    let trimmed_line_slice = &mut line_bytes_mut[start..end];

                    // Skip empty lines (double check after slice)
                    if trimmed_line_slice.is_empty() {
                        trace!(line = line_counter, "Skipping empty line (post-slice)");
                        continue;
                    }

                    // ---- Start Sequential Line Processing ----
                    let line_data_for_error = trimmed_line_slice.to_vec(); // Clone only for potential error message
                    let task_span = info_span!("process_line", line_num = line_counter);
                    let process_result = async {
                        trace!("Attempting to parse JSON line");
                        match simd_json::from_slice::<R>(trimmed_line_slice) {
                            Ok(raw_data) => {
                                trace!("JSON parsed successfully, validating...");
                                raw_data.validate()?;
                                trace!("Validation successful, converting to rows...");
                                let rows = raw_data.into_rows(enrichment.clone())?; // Clone enrichment per line
                                let num_rows = rows.len();
                                trace!(count = num_rows, "Converted to rows, sending to channel...");
                                let mut processed_in_task = 0;
                                for row in rows {
                                    let send_start = Instant::now();
                                    trace!("Sending record to background channel...");
                                    // Send directly using self.record_sender
                                    self.record_sender.send(row).await.map_err(|e| { 
                                        error!(error = %e, "Failed to send record to background processor channel");
                                        AppError::new(
                                            ErrorCode::StreamProcessingError,
                                            format!("Failed to send record to processor: {}", e),
                                        )
                                    })?;
                                    let send_duration = send_start.elapsed();
                                    trace!(duration_ms = send_duration.as_millis(), "Record sent to channel");
                                    processed_in_task += 1;
                                }
                                debug!(rows_processed = processed_in_task, "Line processed successfully");
                                Ok(processed_in_task) // Return count for this line
                            }
                            Err(e) => {
                                let line_preview = String::from_utf8_lossy(&line_data_for_error);
                                error!(error = %e, line = %line_preview.chars().take(100).collect::<String>(), "Failed to parse JSON line");
                                Err(AppError::new(
                                    ErrorCode::StreamDecodingError,
                                    format!(
                                        "Failed to parse JSON line (bytes): '{}': {}",
                                        line_preview.chars().take(100).collect::<String>(),
                                        e
                                    ),
                                ))
                            }
                        }
                    }.instrument(task_span).await; // Await the processing immediately

                    match process_result {
                        Ok(count) => total_processed += count, // Add to total
                        Err(app_err) => {
                            error!(error = %app_err, "Line processing failed");
                            return Err(app_err); // Propagate error immediately
                        }
                    }
                    // ---- End Sequential Line Processing ----
                }
            }

            // After the stream ends, check if there's any remaining data in the buffer
            // Drain the remaining buffer
            let mut remaining_bytes = line_buffer.drain(..).collect::<Vec<u8>>();
            let start = remaining_bytes.iter().position(|&b| !matches!(b, b' ' | b'\t')).unwrap_or(0);
            let end = remaining_bytes.iter().rposition(|&b| !matches!(b, b'\r' | b'\n' | b' ' | b'\t')).map_or(0, |p| p + 1);

            // Process the remaining data if it's not empty
            if start < end {
                line_counter += 1;
                let trimmed_line_slice = &mut remaining_bytes[start..end];
                
                if !trimmed_line_slice.is_empty() {
                    info!(
                        line = line_counter,
                        bytes = trimmed_line_slice.len(),
                        "Processing remaining data in buffer"
                    );

                    let line_data_for_error = trimmed_line_slice.to_vec(); // Clone only for error message
                    let task_span = info_span!("process_line", line_num = line_counter);
                    let process_result = async {
                        match simd_json::from_slice::<R>(trimmed_line_slice) {
                            Ok(raw_data) => {
                                raw_data.validate()?;
                                let rows = raw_data.into_rows(enrichment.clone())?; // Clone enrichment
                                let mut processed_in_task = 0;
                                for row in rows {
                                    let send_start = Instant::now();
                                    trace!("Sending remaining record to background channel...");
                                    // Send directly
                                    self.record_sender.send(row).await.map_err(|e| {
                                        error!(error = %e, "Failed to send remaining record to background processor channel");
                                        AppError::new(
                                            ErrorCode::StreamProcessingError,
                                            format!("Failed to send record to processor: {}", e),
                                        )
                                    })?;
                                    let send_duration = send_start.elapsed();
                                    if send_duration > Duration::from_millis(10) {
                                        warn!(duration_ms = send_duration.as_millis(), "Sending remaining record to channel took longer than expected");
                                    }
                                    trace!(duration_ms = send_duration.as_millis(), "Remaining record sent to channel");
                                    processed_in_task += 1;
                                }
                                debug!(rows_processed = processed_in_task, "Remaining line processed successfully");
                                Ok(processed_in_task)
                            }
                            Err(e) => {
                                let line_preview = String::from_utf8_lossy(&line_data_for_error);
                                error!(error = %e, line = %line_preview.chars().take(100).collect::<String>(), "Failed to parse final JSON line");
                                Err(AppError::new(
                                    ErrorCode::StreamDecodingError,
                                    format!(
                                        "Failed to parse final JSON line (bytes): '{}': {}",
                                        line_preview.chars().take(100).collect::<String>(),
                                        e
                                    ),
                                ))
                            }
                        }
                    }.instrument(task_span).await; // Await immediately

                    match process_result {
                        Ok(count) => total_processed += count, // Add to total
                        Err(app_err) => {
                            error!(error = %app_err, "Final line processing failed");
                            return Err(app_err); // Propagate error immediately
                        }
                    }
                }
            }

            // All lines processed sequentially (or an error was returned)
            let final_count = total_processed; // Use the direct counter
            let total_duration_sec = start_time.elapsed().as_secs_f64();
            let rate = if total_duration_sec > 0.0 {
                final_count as f64 / total_duration_sec
            } else {
                0.0 // Avoid division by zero if processing was instantaneous
            };

            // Log final summary statistics
            info!(
                processed_records = final_count,
                total_duration_sec = format!("{:.2}", total_duration_sec),
                records_per_sec = format!("{:.2}", rate),
                lines_processed = line_counter, // Log total lines encountered
                "Stream processing finished successfully"
            );

            // Return a success message with the total count
            Ok(format!(
                "Stream processed successfully: {} records",
                final_count
            ))
        }.instrument(span).await // Instrument the main async block
    }
}
