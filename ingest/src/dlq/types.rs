use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

/// Envelope for serializing batches to disk
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BatchEnvelope<T> {
    /// Table name this batch belongs to (e.g., "mlop_metrics")
    pub table_name: String,
    /// Timestamp when batch was persisted
    pub timestamp: DateTime<Utc>,
    /// Number of records in this batch
    pub record_count: usize,
    /// The actual records
    pub records: Vec<T>,
}

/// Statistics about DLQ operations
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct DlqStats {
    /// Total batches persisted to DLQ
    pub batches_persisted_total: u64,
    /// Total batches successfully replayed
    pub batches_replayed_total: u64,
    /// Number of batches currently pending replay
    pub batches_pending: u64,
    /// Number of records in pending batches
    pub records_pending: u64,
    /// Disk usage in MB
    pub disk_usage_mb: u64,
    /// Age of oldest batch in hours
    pub oldest_batch_age_hours: f64,
}

/// Statistics returned by DLQ health endpoint
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct DlqHealthStats {
    /// Number of batches currently pending replay
    pub batches_pending: u64,
    /// Estimated number of records in pending batches
    /// (approximated from file size to keep health check fast)
    pub records_pending: u64,
    /// Disk usage in MB
    pub disk_usage_mb: u64,
}

/// Statistics from a replay operation
#[derive(Debug, Clone, Default)]
pub struct ReplayStats {
    /// Number of records successfully replayed
    pub replayed: usize,
    /// Number of batches that failed to load or replay
    pub failed_batches: usize,
    /// Number of records in batches that failed to replay
    pub failed_records: usize,
}

/// Statistics from a cleanup operation
#[derive(Debug, Clone, Default)]
pub struct CleanupStats {
    /// Number of batches deleted
    pub deleted: usize,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_batch_envelope_serialization() {
        let envelope = BatchEnvelope {
            table_name: "mlop_metrics".to_string(),
            timestamp: Utc::now(),
            record_count: 3,
            records: vec![1, 2, 3],
        };

        let json = serde_json::to_string(&envelope).unwrap();
        let deserialized: BatchEnvelope<i32> = serde_json::from_str(&json).unwrap();

        assert_eq!(envelope.table_name, deserialized.table_name);
        assert_eq!(envelope.record_count, deserialized.record_count);
        assert_eq!(envelope.records, deserialized.records);
    }

    #[test]
    fn test_dlq_stats_default() {
        let stats = DlqStats::default();
        assert_eq!(stats.batches_persisted_total, 0);
        assert_eq!(stats.batches_replayed_total, 0);
        assert_eq!(stats.batches_pending, 0);
    }
}
