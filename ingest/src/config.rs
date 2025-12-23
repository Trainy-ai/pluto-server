use std::time::Duration;

// Holds application configuration loaded from environment variables
#[derive(Debug, Clone)]
pub struct Config {
    // ClickHouse connection details
    pub clickhouse_url: String,
    pub clickhouse_user: String,
    pub clickhouse_password: String,
    // S3-compatible storage credentials and settings
    pub storage_access_key_id: String,
    pub storage_secret_access_key: String,
    pub storage_bucket: String,
    pub storage_region: String,
    pub storage_endpoint: String, // e.g., "https://<accountid>.r2.cloudflarestorage.com" or "s3.us-west-2.amazonaws.com"
    // Primary database (PostgreSQL) connection URL
    pub database_url: String,
}

impl Config {
    // Loads configuration from environment variables
    // Panics if any required variable is not set
    pub fn new() -> Self {
        // Load R2 Account ID first to construct the endpoint URL - Removed as endpoint is now explicit
        // let r2_account_id = std::env::var("R2_ACCOUNT_ID").expect("R2_ACCOUNT_ID is not set");
        // let r2_endpoint = format!("https://{}.r2.cloudflarestorage.com", &r2_account_id);

        Self {
            clickhouse_url: std::env::var("CLICKHOUSE_URL").expect("CLICKHOUSE_URL is not set"),
            clickhouse_user: std::env::var("CLICKHOUSE_USER").expect("CLICKHOUSE_USER is not set"),
            clickhouse_password: std::env::var("CLICKHOUSE_PASSWORD")
                .expect("CLICKHOUSE_PASSWORD is not set"),
            storage_access_key_id: std::env::var("STORAGE_ACCESS_KEY_ID")
                .expect("STORAGE_ACCESS_KEY_ID is not set"),
            storage_secret_access_key: std::env::var("STORAGE_SECRET_ACCESS_KEY")
                .expect("STORAGE_SECRET_ACCESS_KEY is not set"),
            storage_bucket: std::env::var("STORAGE_BUCKET").expect("STORAGE_BUCKET is not set"),
            storage_region: std::env::var("STORAGE_REGION").expect("STORAGE_REGION is not set"),
            storage_endpoint: std::env::var("STORAGE_ENDPOINT")
                .expect("STORAGE_ENDPOINT is not set"),
            database_url: std::env::var("DATABASE_DIRECT_URL")
                .expect("DATABASE_DIRECT_URL is not set"),
        }
    }

    // Creates a test configuration with default values
    // Used in testing to avoid requiring environment variables
    #[cfg(test)]
    pub fn for_testing() -> Self {
        Self {
            clickhouse_url: "http://localhost:8123".to_string(),
            clickhouse_user: "default".to_string(),
            clickhouse_password: "".to_string(),
            storage_access_key_id: "test".to_string(),
            storage_secret_access_key: "test".to_string(),
            storage_bucket: "test-bucket".to_string(),
            storage_region: "us-east-1".to_string(),
            storage_endpoint: "http://localhost:9000".to_string(),
            database_url: "postgresql://test:test@localhost:5432/test".to_string(),
        }
    }
}

// Constants for ClickHouse table names
pub const METRICS_TABLE_NAME: &str = "mlop_metrics";
pub const LOGS_TABLE_NAME: &str = "mlop_logs";
pub const DATA_TABLE_NAME: &str = "mlop_data";
pub const FILES_TABLE_NAME: &str = "mlop_files";

// Configuration for the background flush behavior
pub struct FlushConfig {
    pub batch_size: usize,        // Number of records to buffer before flushing
    pub flush_interval: Duration, // Maximum time to wait before flushing (if batch size not reached)
}

// Flush configuration specifically for metrics data
pub const METRICS_FLUSH_CONFIG: FlushConfig = FlushConfig {
    batch_size: 500_000,                    // High batch size for metrics
    flush_interval: Duration::from_secs(5), // Flush every 5 seconds if needed
};

// Flush configuration specifically for log data
pub const LOGS_FLUSH_CONFIG: FlushConfig = FlushConfig {
    batch_size: 500_000,                    // High batch size for logs
    flush_interval: Duration::from_secs(5), // Flush frequently (every 1 second)
};

// Flush configuration specifically for generic data
pub const DATA_FLUSH_CONFIG: FlushConfig = FlushConfig {
    batch_size: 500_000,                    // High batch size for data
    flush_interval: Duration::from_secs(5), // Flush frequently (every 1 second)
};

// Flush configuration specifically for file metadata
pub const FILES_FLUSH_CONFIG: FlushConfig = FlushConfig {
    batch_size: 500_000, // Lower batch size for file metadata (less frequent but larger records?)
    flush_interval: Duration::from_secs(5), // Flush every 5 seconds
};
